"""Weekly plan check: look back at the last two weeks and propose changes for the coming one.

Rules (first match decides the volume change; hard-session and fitness rules can add to it):
  - tired (needs rest, high fatigue, load rising too fast, injury) → make the week lighter;
  - consistently short of the plan (< 80% of planned km) → trim the week so it builds from what was run;
  - comfortably ahead (> 105%) and fresh, fitness rising → lengthen the long run a little;
  - two or more key sessions missed last week → keep only the first hard session;
  - fitness clearly up since the plan was made → lengthen the long run (paces already follow VDOT).
Nothing changes until the user applies the proposal; past days and finished workouts are never touched.
"""

from __future__ import annotations

import json
from datetime import date, timedelta

from sqlmodel import Session, col, select

from app.analytics import condition as condition_mod
from app.analytics import progress as P
from app.models import FitnessSnapshot, Plan, PlannedWorkout
from app.planner import edit as edit_mod
from app.planner import races as races_mod
from app.planner.service import match_status, plan_view, runs_by_day

STATE_KEY = "plan_check"
KEY_KINDS = races_mod.QUALITY | {"long"}


def target_week(today: date) -> date:
    """The week to adjust: this week on a Monday, otherwise the next one."""
    return today if today.weekday() == 0 else today + timedelta(days=7 - today.weekday())


def _status(session: Session, week: date) -> str | None:
    from app.ingest.garmin_sync import get_state

    try:
        raw = json.loads(get_state(session, STATE_KEY) or "{}")
    except ValueError:
        return None
    return raw.get("status") if raw.get("week_start") == week.isoformat() else None


def set_status(session: Session, week: date, status: str) -> None:
    from app.ingest.garmin_sync import _set_state

    _set_state(session, STATE_KEY, json.dumps({"week_start": week.isoformat(), "status": status}))


def _week_workouts(session: Session, plan: Plan, monday: date) -> list[PlannedWorkout]:
    return list(session.exec(
        select(PlannedWorkout).where(PlannedWorkout.plan_id == plan.id, PlannedWorkout.day >= monday,
                                     PlannedWorkout.day < monday + timedelta(days=7)).order_by(col(PlannedWorkout.day))
    ))


def _change(w: PlannedWorkout, kind: str, title: str, km: float, reason: str) -> dict:
    return {"op": "check", "workout_id": w.id, "day": w.day.isoformat(),
            "before": {"title": w.title, "kind": w.kind, "km": round((w.target_distance_m or 0) / 1000, 1)},
            "after": {"title": title, "kind": kind, "km": round(km, 1)}, "reason": reason}


def _round(km: float) -> float:
    return max(3.0, round(km * 2) / 2)


def _goal_trend(session: Session, today: date) -> dict | None:
    snaps = {s.day: s for s in session.exec(select(FitnessSnapshot).where(FitnessSnapshot.day >= today - timedelta(days=35)))}
    now = snaps.get(today) or (max(snaps.values(), key=lambda s: s.day) if snaps else None)
    if not now or not now.goal:
        return None
    prev = min((s for s in snaps.values() if s.goal and s.day <= today - timedelta(days=6)), key=lambda s: abs((today - timedelta(days=7) - s.day).days), default=None)
    g = now.goal
    return {"name": g.get("name"), "target_s": g.get("target_s"), "predicted_s": g.get("predicted_race_day_s") or g.get("predicted_now_s"),
            "chance": g.get("chance"), "chance_prev": prev.goal.get("chance") if prev else None,
            "predicted_prev_s": (prev.goal.get("predicted_race_day_s") or prev.goal.get("predicted_now_s")) if prev else None}


def check(session: Session, plan: Plan, today: date | None = None) -> dict:
    today = today or date.today()
    week = target_week(today)
    view = plan_view(session, plan)
    weeks = {w["week_start"]: w for w in view["weeks"]}
    # The two most recent complete weeks.
    this_monday = today - timedelta(days=today.weekday())
    past = [weeks[ws] for ws in ((this_monday - timedelta(days=7 * k)).isoformat() for k in (1, 2))
            if ws in weeks and weeks[ws]["planned_km"] > 0]
    planned = sum(w["planned_km"] for w in past)
    actual = sum(w["actual_km"] or 0 for w in past)
    ratio = actual / planned if planned else None

    # Key sessions missed from last Monday up to yesterday.
    since = this_monday - timedelta(days=7)
    runs = runs_by_day(session, since, today - timedelta(days=1))
    recent = list(session.exec(select(PlannedWorkout).where(PlannedWorkout.plan_id == plan.id, PlannedWorkout.day >= since,
                                                            PlannedWorkout.day < today)))
    missed = [w for w in recent if w.kind in KEY_KINDS and match_status(w, runs.get(w.day, []), today)[0] == "missed"]

    cond = condition_mod.compute(session, today)
    tired = cond["form"]["state"] == "rest" or cond["fatigue"]["state"] == "high" or cond["ramp"]["state"] == "risk"
    series = P.fitness_series(session)
    vdot_now = float(series["v"].iloc[-1]) if len(series) else None
    vdot_start = (plan.params or {}).get("vdot_at_creation")
    vdot_4w = float(series["v"].iloc[-29]) if len(series) > 29 else None
    recent_race = session.exec(select(PlannedWorkout).where(PlannedWorkout.plan_id == plan.id, PlannedWorkout.kind == "race",
                                                           PlannedWorkout.day >= today - timedelta(days=10), PlannedWorkout.day < week)).first()

    week_all = _week_workouts(session, plan, week)
    race_days = {w.day for w in week_all if w.kind == "race"} | {w.day for w in session.exec(
        select(PlannedWorkout).where(PlannedWorkout.plan_id == plan.id, PlannedWorkout.kind == "race",
                                     PlannedWorkout.day >= week + timedelta(days=7), PlannedWorkout.day <= week + timedelta(days=9)))}

    def near_race(d: date) -> bool:
        return any(0 < (r - d).days <= 2 or 0 < (d - r).days <= 1 for r in race_days)

    # Race-day tapers/shakeouts and easy runs with strides keep their shape.
    workouts = [w for w in week_all if w.status == "planned" and w.day >= today and w.kind != "race" and not near_race(w.day)
                and not (w.kind in ("easy", "recovery") and len(w.structure or []) > 1)]
    changes: list[dict] = []
    notes: list[str] = []
    touched: set[int] = set()

    def add(ch: dict) -> None:
        touched.add(ch["workout_id"])
        changes.append(ch)

    if ratio is not None:
        notes.append(f"지난 {len(past)}주 계획 {planned:.0f}km 중 {actual:.0f}km를 달렸어요 ({ratio:.0%}).")
    if recent_race:
        notes.append(f"'{recent_race.title.replace('🏁 ', '')}' 뒤 회복 기간이라 거리를 늘리지 않아요.")

    if tired:
        why = cond["form"]["label"] if cond["form"]["state"] == "rest" else "피로가 많이 쌓였어요" if cond["fatigue"]["state"] == "high" else "부하가 너무 빨리 늘었어요"
        for ch in edit_mod.week_changes(session, plan, week, "lighter", today):
            add({**ch, "op": "check", "reason": f"{why} → {ch['reason']}"})
        notes.append(f"{why}. 다음 주는 가볍게 가요.")
    elif ratio is not None and ratio < 0.8 and not recent_race:
        week_km = sum((w.target_distance_m or 0) / 1000 for w in workouts)
        goal_km = max(actual / max(len(past), 1) * 1.1, week_km * 0.7)
        f = max(0.7, min(0.95, goal_km / week_km)) if week_km else 1.0
        if f < 0.95:
            for w in workouts:
                if w.kind in ("easy", "recovery", "long"):
                    km = _round((w.target_distance_m or 0) / 1000 * f)
                    if km < (w.target_distance_m or 0) / 1000 - 0.4:
                        title = f"롱런 {km:g}km" if w.kind == "long" else f"이지런 {km:g}km"
                        add(_change(w, w.kind if w.kind == "long" else "easy", title, km, f"계획보다 적게 달렸어요 → 다시 쌓기 위해 {100 - f * 100:.0f}% 줄여요"))
            notes.append("계획보다 적게 달렸어요. 다음 주는 거리를 줄여 무리 없이 다시 쌓아요.")
    elif ratio is not None and ratio > 1.05 and cond["fatigue"]["state"] != "high" and not recent_race:
        long = next((w for w in workouts if w.kind == "long"), None)
        if long:
            km = _round((long.target_distance_m or 0) / 1000 + 1.5)
            add(_change(long, "long", f"롱런 {km:g}km", km, "계획보다 여유 있게 소화했어요 → 롱런 1.5km 늘려요"))
            notes.append("계획을 여유 있게 소화했어요. 롱런을 조금 늘려요.")

    if len(missed) >= 2:
        hard = [w for w in workouts if w.kind in races_mod.QUALITY and w.id not in touched]
        for w in hard[1:]:
            km = _round((w.target_distance_m or 0) / 1000 * 0.8)
            add(_change(w, "easy", f"이지런 {km:g}km", km, "놓친 강훈련이 많았어요 → 한 번만 하고 리듬을 되찾아요"))
        notes.append(f"최근 핵심 훈련 {len(missed)}개를 놓쳤어요: " + ", ".join(w.title for w in missed[:3]) + ".")

    if (vdot_now and vdot_start and vdot_now - vdot_start >= 1.0 and not tired and not recent_race
            and not any(c["after"]["kind"] == "long" for c in changes)):
        long = next((w for w in workouts if w.kind == "long" and w.id not in touched), None)
        if long:
            km = _round((long.target_distance_m or 0) / 1000 + 1)
            add(_change(long, "long", f"롱런 {km:g}km", km, f"체력이 플랜을 만들 때보다 {vdot_now - vdot_start:+.1f} 올랐어요 → 롱런 1km 늘려요"))
    if vdot_now and vdot_4w:
        d = vdot_now - vdot_4w
        notes.append(f"체력(VDOT)은 4주 전보다 {d:+.1f}이에요. 페이스는 자동으로 따라가요." if abs(d) >= 0.3 else "체력은 4주 전과 비슷해요.")
    if not changes:
        notes.append("다음 주는 계획대로 가면 돼요.")

    return {
        "week_start": week.isoformat(),
        "status": _status(session, week),
        "notes": notes,
        "changes": sorted(changes, key=lambda c: c["day"]),
        "stats": {"ratio": None if ratio is None else round(ratio, 2), "missed": len(missed),
                  "vdot_now": None if vdot_now is None else round(vdot_now, 1), "vdot_start": vdot_start},
        "goal": _goal_trend(session, today),
    }


def apply(session: Session, plan: Plan, today: date | None = None) -> int:
    today = today or date.today()
    result = check(session, plan, today)
    p = edit_mod.plan_params(session, plan)
    n = 0
    for ch in result["changes"]:
        w = session.get(PlannedWorkout, ch["workout_id"])
        if w is None or w.status != "planned" or w.day < today:
            continue
        km = ch["after"]["km"]
        if ch["after"]["kind"] == "long":
            keep_mp = any(s.get("pace") in ("M", "RP") for s in (w.structure or []))
            edit_mod.set_template(p, w, "long_m" if keep_mp else "long", km)
        else:
            races_mod._set_easy(w, km)
        session.add(w)
        n += 1
    session.commit()
    set_status(session, date.fromisoformat(result["week_start"]), "applied")
    return n
