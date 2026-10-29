"""Race calendar ↔ training plan.

Priorities:
  A — goal race. The plan is built around it (taper, peak).
  B — important race inside the plan: a short taper before, recovery days after.
  C — training race: it replaces that week's quality session; only the hard days next to it soften.

`adjustments()` describes what folding a race into the active plan would change (a preview);
`apply()` performs it. Past days and completed/skipped workouts are never touched.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from sqlmodel import Session, col, select

from app.analytics import physio
from app.analytics import progress as progress_mod
from app.models import Activity, GoalRace, Plan, PlannedWorkout

QUALITY = {"tempo", "interval", "mp"}
HARD = QUALITY | {"long"}
EASY_TSS_PER_KM = 5.4 / 60 * 0.72**2 * 100  # ~5:24/km at IF 0.72


def _km(m: float | None) -> float:
    return round((m or 0) / 1000, 1)


def _desc(w: PlannedWorkout | None) -> dict | None:
    return None if w is None else {"title": w.title, "kind": w.kind, "km": _km(w.target_distance_m)}


def current_vdot(session: Session) -> float | None:
    pts = progress_mod.vdot_points(session)
    return progress_mod.current_state(session, pts, progress_mod.fitness_series(session))["vdot"]


def predicted_time_s(distance_m: float, vdot: float | None) -> float | None:
    return round(physio.race_time_for_vdot(distance_m, vdot)) if vdot else None


def race_zone(distance_m: float) -> str:
    # Daniels: ~5–10K is raced near I pace, half near T, marathon at M.
    return "I" if distance_m <= 12000 else "T" if distance_m <= 25000 else "M"


def race_tss(distance_m: float, time_s: float | None) -> float:
    hours = (time_s or distance_m / 1000 * 330) / 3600
    intensity = 1.05 if distance_m <= 5500 else 1.0 if distance_m <= 12000 else 0.92 if distance_m <= 25000 else 0.82
    return round(hours * intensity**2 * 100, 1)


# ---------- results ----------

def link_results(session: Session, today: date | None = None) -> None:
    """Attach the run done on race day (distance within 15%) to past races that have no result yet."""
    today = today or date.today()
    changed = False
    for r in session.exec(select(GoalRace).where(GoalRace.race_day <= today, col(GoalRace.result_activity_id).is_(None))):
        day0 = datetime.combine(r.race_day, datetime.min.time())
        runs = session.exec(
            select(Activity).where(
                col(Activity.sport).contains("run"), Activity.start_time >= day0, Activity.start_time < day0 + timedelta(days=1),
            )
        ).all()
        fits = [a for a in runs if abs(a.distance_m - r.distance_m) <= 0.15 * r.distance_m]
        if fits:
            best = min(fits, key=lambda a: (a.run_type != "race", abs(a.distance_m - r.distance_m)))
            r.result_activity_id = best.id
            session.add(r)
            changed = True
    if changed:
        session.commit()


# ---------- plan integration ----------

def _plan_workouts(session: Session, plan: Plan) -> dict[date, list[PlannedWorkout]]:
    by_day: dict[date, list[PlannedWorkout]] = {}
    for w in session.exec(select(PlannedWorkout).where(PlannedWorkout.plan_id == plan.id).order_by(col(PlannedWorkout.id))):
        by_day.setdefault(w.day, []).append(w)
    return by_day


def link_goal(session: Session, plan: Plan) -> None:
    """Plans made before races were linked: tie the race-day workout to the plan's goal race."""
    if not plan.goal_race_id:
        return
    goal = session.get(GoalRace, plan.goal_race_id)
    if goal is None:
        return
    w = session.exec(
        select(PlannedWorkout).where(PlannedWorkout.plan_id == plan.id, PlannedWorkout.kind == "race",
                                     PlannedWorkout.day == goal.race_day, col(PlannedWorkout.race_id).is_(None))
    ).first()
    if w:
        w.race_id = goal.id
        session.add(w)
        session.commit()


def integrated(session: Session, plan: Plan, race: GoalRace) -> bool:
    return session.exec(
        select(PlannedWorkout.id).where(PlannedWorkout.plan_id == plan.id, PlannedWorkout.race_id == race.id)
    ).first() is not None


def in_plan_period(plan: Plan, race: GoalRace) -> bool:
    return plan.start_day <= race.race_day <= plan.end_day


def adjustments(session: Session, plan: Plan, race: GoalRace, today: date | None = None) -> list[dict]:
    """Changes that would fold `race` into `plan`, as {op, workout_id, day, before, after, reason}."""
    today = today or date.today()
    if (race.id == plan.goal_race_id or race.race_day < today or not in_plan_period(plan, race)
            or integrated(session, plan, race)):
        return []
    by_day = _plan_workouts(session, plan)
    d, dist = race.race_day, race.distance_m
    long_race = dist >= 20000
    ops: list[dict] = []
    touched: set[int] = set()

    def editable(w: PlannedWorkout) -> bool:
        return w.status == "planned" and w.kind != "race" and w.day >= today and w.id not in touched

    def add(op: str, w: PlannedWorkout | None, day: date, after: dict, reason: str) -> None:
        if w is not None:
            touched.add(w.id)
        ops.append({"op": op, "workout_id": w.id if w else None, "day": day.isoformat(),
                    "before": _desc(w), "after": after, "reason": reason})

    # Race day itself (an unlinked race workout already there is reused, never duplicated).
    same_day = [w for w in by_day.get(d, []) if editable(w) or (w.kind == "race" and w.race_id is None and w.status == "planned")]
    add("race", same_day[0] if same_day else None, d,
        {"title": f"🏁 {race.name}", "kind": "race", "km": _km(dist)}, "대회")
    for extra in same_day[1:]:
        add("rest", extra, d, {"title": "휴식", "kind": "rest", "km": 0}, "대회 날이라 다른 훈련은 빼요")

    if race.priority in ("A", "B"):
        for k in range(1, (3 if long_race else 2) + 1):
            for w in by_day.get(d - timedelta(days=k), []):
                if not editable(w):
                    continue
                if k == 1 and (w.kind in HARD or (w.target_distance_m or 0) > 6000):
                    add("shakeout", w, w.day, {"title": "가볍게 + 스트라이드", "kind": "easy", "km": 4.0}, "대회 전날은 가볍게")
                elif k > 1 and w.kind in HARD:
                    km = min(_km(w.target_distance_m), 6.0)
                    add("easy", w, w.day, {"title": f"이지런 {km:g}km", "kind": "easy", "km": km}, "대회 전 강훈련은 쉬운 조깅으로")
        recovery = 7 if dist >= 40000 else 4 if long_race else 2
        for k in range(1, recovery + 1):
            for w in by_day.get(d + timedelta(days=k), []):
                if not editable(w) or w.kind == "rest":
                    continue
                if k == 1 and long_race:
                    add("rest", w, w.day, {"title": "휴식", "kind": "rest", "km": 0}, "장거리 대회 다음 날은 쉬어요")
                elif w.kind in HARD:
                    km = min(_km(w.target_distance_m), 8.0)
                    add("easy", w, w.day, {"title": f"이지런 {km:g}km", "kind": "easy", "km": km}, "대회 후 회복 기간")
    else:  # C: the race is this week's hard session
        for k in (-2, -1, 1, 2):
            for w in by_day.get(d + timedelta(days=k), []):
                if editable(w) and (w.kind in QUALITY or (w.kind == "long" and abs(k) == 1)):
                    km = min(_km(w.target_distance_m), 8.0)
                    add("easy", w, w.day, {"title": f"이지런 {km:g}km", "kind": "easy", "km": km},
                        "대회가 이번 주 강훈련을 대신해요")
    # Race first, then the surrounding days in calendar order.
    return [ops[0], *sorted(ops[1:], key=lambda o: o["day"])]


def _phase_for(plan: Plan, day: date) -> str | None:
    monday = (day - timedelta(days=day.weekday())).isoformat()
    for w in (plan.params or {}).get("weeks", []):
        if w.get("week_start") == monday:
            return w.get("phase")
    return None


def _set_easy(w: PlannedWorkout, km: float) -> None:
    w.kind, w.title = "easy", f"이지런 {km:g}km"
    w.target_distance_m = km * 1000
    w.structure = [{"type": "run", "distance_m": km * 1000, "pace": "E"}]
    w.target_tss = round(km * EASY_TSS_PER_KM, 1)


def apply(session: Session, plan: Plan, race: GoalRace, vdot: float | None = None, today: date | None = None) -> int:
    ops = adjustments(session, plan, race, today)
    if not ops:
        return 0
    t = race.target_time_s or predicted_time_s(race.distance_m, vdot if vdot is not None else current_vdot(session))
    for op in ops:
        day = date.fromisoformat(op["day"])
        w = session.get(PlannedWorkout, op["workout_id"]) if op["workout_id"] else None
        if w is None:
            w = PlannedWorkout(plan_id=plan.id, day=day, kind="rest", title="", phase=_phase_for(plan, day))
        if op["op"] == "race":
            w.kind, w.title, w.race_id = "race", f"🏁 {race.name}", race.id
            w.target_distance_m = race.distance_m
            w.structure = [{"type": "run", "distance_m": race.distance_m, "pace": race_zone(race.distance_m)}]
            w.target_tss = race_tss(race.distance_m, t)
            w.note = race.location or w.note
        elif op["op"] == "easy":
            _set_easy(w, op["after"]["km"])
        elif op["op"] == "shakeout":
            w.kind, w.title, w.target_distance_m = "easy", "가볍게 + 스트라이드", 4000
            w.structure = [
                {"type": "run", "distance_m": 3000, "pace": "E"},
                {"type": "repeat", "reps": 4, "steps": [{"type": "run", "duration_s": 20, "pace": "R"},
                                                        {"type": "recover", "duration_s": 60, "pace": "E"}]},
            ]
            w.target_tss = round(4 * EASY_TSS_PER_KM + 3, 1)
        elif op["op"] == "rest":
            w.kind, w.title, w.target_distance_m, w.structure, w.target_tss = "rest", "휴식", 0, [], 0
        session.add(w)
    session.commit()
    return len(ops)


def unlink(session: Session, race: GoalRace) -> int:
    """Race deleted or moved: its race-day workouts become rest days (plans keep their shape)."""
    n = 0
    for w in session.exec(select(PlannedWorkout).where(PlannedWorkout.race_id == race.id)):
        w.race_id = None
        if w.status == "planned":
            w.kind, w.title, w.target_distance_m, w.structure, w.target_tss = "rest", "휴식", 0, [], 0
        session.add(w)
        n += 1
    session.commit()
    return n


# ---------- views ----------

def race_view(session: Session, race: GoalRace, plan: Plan | None, vdot: float | None, today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    out: dict[str, Any] = {
        **race.model_dump(),
        "d_day": (race.race_day - today).days,
        "predicted_time_s": predicted_time_s(race.distance_m, vdot) if race.race_day >= today else None,
        "is_plan_goal": bool(plan and plan.goal_race_id == race.id),
        "in_plan_period": bool(plan and in_plan_period(plan, race)),
        "in_plan": bool(plan and integrated(session, plan, race)),
        "result": None,
    }
    if race.result_activity_id:
        a = session.get(Activity, race.result_activity_id)
        if a:
            moving = a.moving_time_s or a.duration_s
            out["result"] = {"activity_id": a.id, "time_s": round(moving), "km": _km(a.distance_m),
                             "pace_s_per_km": round(moving / (a.distance_m / 1000)) if a.distance_m else None,
                             "name": a.name}
    return out


def list_view(session: Session, plan: Plan | None) -> list[dict]:
    link_results(session)
    if plan:
        link_goal(session, plan)
    vdot = current_vdot(session)
    races = session.exec(select(GoalRace).order_by(col(GoalRace.race_day))).all()
    return [race_view(session, r, plan, vdot) for r in races]


def plan_races(session: Session, plan: Plan) -> list[dict]:
    """Races inside the plan period, each with its integration status and preview."""
    link_goal(session, plan)
    vdot = current_vdot(session)
    races = session.exec(
        select(GoalRace).where(GoalRace.race_day >= plan.start_day, GoalRace.race_day <= plan.end_day).order_by(col(GoalRace.race_day))
    ).all()
    return [{**race_view(session, r, plan, vdot), "changes": adjustments(session, plan, r)} for r in races]


def upcoming_for_ai(session: Session, days: int = 200, today: date | None = None) -> list[dict]:
    """Compact race calendar for AI prompts."""
    today = today or date.today()
    rows = session.exec(
        select(GoalRace).where(GoalRace.race_day >= today, GoalRace.race_day <= today + timedelta(days=days))
        .order_by(col(GoalRace.race_day))
    ).all()
    return [
        {"name": r.name, "day": r.race_day.isoformat(), "days_left": (r.race_day - today).days, "km": _km(r.distance_m),
         "priority": r.priority, "goal_time_s": r.target_time_s, "location": r.location}
        for r in rows
    ]
