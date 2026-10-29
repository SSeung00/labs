"""Editing an active plan: workout templates, swapping days, week-level adjustments, regeneration.

Every bulk change has a dry run that returns the same {workout_id, day, before, after, reason} list
the race integration uses, so the UI can preview it before applying. Past days and workouts that
are done or skipped are never touched.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime, timedelta

from sqlmodel import Session, col, select

from app.models import Activity, GoalRace, Plan, PlannedWorkout
from app.planner import generator as gen
from app.planner import races as races_mod

# ---------- params ----------


def plan_params(session: Session, plan: Plan, vdot: float | None = None) -> gen.PlanParams:
    prm = plan.params or {}
    race = session.get(GoalRace, plan.goal_race_id) if plan.goal_race_id else None
    return gen.PlanParams(
        race_distance_m=prm.get("race_distance_m") or (race.distance_m if race else 42195),
        race_day=race.race_day if race else plan.end_day,
        start_day=plan.start_day,
        days_per_week=prm.get("days_per_week", 5),
        long_run_dow=prm.get("long_run_dow", 6),
        current_weekly_km=prm.get("current_weekly_km", 25),
        peak_weekly_km=prm.get("peak_weekly_km"),
        vdot=vdot or races_mod.current_vdot(session) or prm.get("vdot_at_creation") or 45,
        goal_time_s=prm.get("goal_time_s"),
    )


# ---------- templates ----------

def _easy(km: float) -> tuple[str, str, list[dict]]:
    return "easy", f"이지런 {km:g}km", [{"type": "run", "distance_m": km * 1000, "pace": "E"}]


def _recovery(km: float) -> tuple[str, str, list[dict]]:
    return "recovery", f"회복 조깅 {km:g}km", [{"type": "run", "distance_m": km * 1000, "pace": "E", "note": "아주 천천히"}]


def _strides(km: float) -> tuple[str, str, list[dict]]:
    return "easy", "이지 + 스트라이드", [
        {"type": "run", "distance_m": max(km - 0.5, 3) * 1000, "pace": "E"},
        {"type": "repeat", "reps": 6, "steps": [{"type": "run", "duration_s": 20, "pace": "R"}, {"type": "recover", "duration_s": 60, "pace": "E"}]},
    ]


def _long(km: float) -> tuple[str, str, list[dict]]:
    return "long", f"롱런 {km:g}km", [{"type": "run", "distance_m": km * 1000, "pace": "E"}]


def _long_m(km: float) -> tuple[str, str, list[dict]]:
    steady = max(2, round(min(8, km * 0.3)))
    return "long", f"롱런 {km:g}km (마지막 {steady}km 마라톤 페이스)", [
        {"type": "run", "distance_m": (km - steady) * 1000, "pace": "E"},
        {"type": "run", "distance_m": steady * 1000, "pace": "M"},
    ]


def _tempo(km: float) -> tuple[str, str, list[dict]]:
    mins = max(15, min(40, round((km - 3.5) * 4.2)))
    return "tempo", f"템포런 {mins}분", [gen._wu(), {"type": "run", "duration_s": mins * 60, "pace": "T"}, gen._cd()]


def _cruise(km: float) -> tuple[str, str, list[dict]]:
    n = max(2, min(6, round((km - 3.5) / 1.6)))
    return "tempo", f"크루즈 인터벌 {n}×1.6km", [
        gen._wu(), {"type": "repeat", "reps": n, "steps": [{"type": "run", "distance_m": 1600, "pace": "T"}, {"type": "recover", "duration_s": 60, "pace": "E"}]}, gen._cd(),
    ]


def _vo2(km: float) -> tuple[str, str, list[dict]]:
    n = max(3, min(8, round((km - 3.5) / 1.4)))
    return "interval", f"VO2max 인터벌 {n}×1km", [
        gen._wu(), {"type": "repeat", "reps": n, "steps": [{"type": "run", "distance_m": 1000, "pace": "I"}, {"type": "recover", "distance_m": 400, "pace": "E"}]}, gen._cd(),
    ]


def _hills(km: float) -> tuple[str, str, list[dict]]:
    reps = max(6, min(12, round((km - 3.5) / 0.55)))
    return "interval", f"언덕 반복 {reps}회", [
        gen._wu(), {"type": "repeat", "reps": reps, "steps": [{"type": "run", "duration_s": 60, "pace": "I", "note": "오르막"}, {"type": "recover", "duration_s": 90, "pace": "E", "note": "내리막 조깅"}]}, gen._cd(),
    ]


def _rp(km: float) -> tuple[str, str, list[dict]]:
    rp_km = max(3, round(km - 3.5))
    return "mp", f"레이스 페이스 {rp_km}km", [gen._wu(), {"type": "run", "distance_m": rp_km * 1000, "pace": "RP"}, gen._cd()]


TEMPLATES: dict[str, tuple[str, Callable[[float], tuple[str, str, list[dict]]]]] = {
    "easy": ("이지런", _easy),
    "recovery": ("회복 조깅", _recovery),
    "strides": ("이지 + 스트라이드", _strides),
    "long": ("롱런", _long),
    "long_m": ("롱런 + 마라톤 페이스", _long_m),
    "tempo": ("템포런", _tempo),
    "cruise": ("크루즈 인터벌", _cruise),
    "vo2": ("VO2max 인터벌", _vo2),
    "hills": ("언덕 반복", _hills),
    "rp": ("레이스 페이스", _rp),
}


def set_template(p: gen.PlanParams, w: PlannedWorkout, key: str, km: float) -> None:
    if key == "rest":
        w.kind, w.title, w.target_distance_m, w.structure, w.target_tss = "rest", "휴식", 0, [], 0
        return
    if key not in TEMPLATES:
        raise ValueError("알 수 없는 훈련 종류예요.")
    if not 2 <= km <= 60:
        raise ValueError("거리는 2–60km 사이로 정해 주세요.")
    kind, title, steps = TEMPLATES[key][1](km)
    w.kind, w.title, w.structure = kind, title, steps
    w.target_distance_m = round(gen.structure_distance(p, steps))
    w.target_tss = gen.estimate_tss(p, steps)


# ---------- swap ----------

def _editable(w: PlannedWorkout, today: date) -> bool:
    return w.kind != "race" and w.status == "planned" and w.day >= today


def swap(session: Session, w: PlannedWorkout, day: date, today: date | None = None) -> int:
    """Exchange `w` with whatever is planned on `day` (both days must be editable)."""
    today = today or date.today()
    if not _editable(w, today) or day < today:
        raise ValueError("지난 날이나 끝난 훈련, 대회는 바꿀 수 없어요.")
    if day == w.day:
        return 0
    others = session.exec(select(PlannedWorkout).where(PlannedWorkout.plan_id == w.plan_id, PlannedWorkout.day == day)).all()
    if any(not _editable(o, today) for o in others):
        raise ValueError("그날의 훈련은 옮길 수 없어요 (대회이거나 이미 끝났어요).")
    src = w.day
    for o in others:
        o.day = src
        session.add(o)
    w.day = day
    session.add(w)
    session.commit()
    return 1 + len(others)


# ---------- week adjustments ----------

def _desc(kind: str, title: str, km: float) -> dict:
    return {"title": title, "kind": kind, "km": round(km, 1)}


def _round_km(km: float) -> float:
    return max(3.0, round(km * 2) / 2)


def week_changes(session: Session, plan: Plan, monday: date, action: str, today: date | None = None) -> list[dict]:
    """What "lighter" (−20%, one hard session kept) or "recovery" (all easy, −40%) would do to a week."""
    today = today or date.today()
    if action not in ("lighter", "recovery"):
        raise ValueError("알 수 없는 동작")
    rows = session.exec(
        select(PlannedWorkout).where(
            PlannedWorkout.plan_id == plan.id, PlannedWorkout.day >= monday, PlannedWorkout.day < monday + timedelta(days=7),
        ).order_by(col(PlannedWorkout.day))
    ).all()
    out: list[dict] = []
    kept_hard = False
    for w in rows:
        if not _editable(w, today) or w.kind == "rest":
            continue
        km = (w.target_distance_m or 0) / 1000
        before = _desc(w.kind, w.title, km)
        hard = w.kind in races_mod.QUALITY
        if action == "recovery":
            new_km = _round_km(km * 0.6)
            after, reason = _desc("easy", f"이지런 {new_km:g}km", new_km), "회복 주: 모두 쉬운 조깅, 거리 40% 줄임"
        elif hard and not kept_hard:
            kept_hard = True
            continue  # the week's first hard session stays as planned
        elif hard:
            new_km = _round_km(km * 0.8)
            after, reason = _desc("easy", f"이지런 {new_km:g}km", new_km), "강훈련은 한 번만 남겨요"
        else:
            new_km = _round_km(km * 0.8)
            if abs(new_km - km) < 0.5:
                continue
            title = f"롱런 {new_km:g}km" if w.kind == "long" else f"이지런 {new_km:g}km"
            after, reason = _desc(w.kind if w.kind == "long" else "easy", title, new_km), "거리 20% 줄임"
        out.append({"op": action, "workout_id": w.id, "day": w.day.isoformat(), "before": before, "after": after, "reason": reason})
    return out


def apply_week(session: Session, plan: Plan, monday: date, action: str, today: date | None = None) -> int:
    changes = week_changes(session, plan, monday, action, today)
    for ch in changes:
        w = session.get(PlannedWorkout, ch["workout_id"])
        if w is None:
            continue
        km = ch["after"]["km"]
        if ch["after"]["kind"] == "long":
            w.title, w.target_distance_m = ch["after"]["title"], km * 1000
            w.structure = [{"type": "run", "distance_m": km * 1000, "pace": "E"}]
            w.target_tss = round(km * races_mod.EASY_TSS_PER_KM, 1)
        else:
            races_mod._set_easy(w, km)
        session.add(w)
    session.commit()
    return len(changes)


# ---------- regenerate the rest of the plan ----------

def regen_from(session: Session, plan: Plan, today: date | None = None) -> date:
    """First day to rebuild: the coming Monday (this week stays as it is), or today on an untouched Monday."""
    today = today or date.today()
    ran = session.exec(
        select(Activity.id).where(
            col(Activity.sport).contains("run"),
            Activity.start_time >= datetime.combine(today, datetime.min.time()),
            Activity.start_time < datetime.combine(today + timedelta(days=1), datetime.min.time()),
        )
    ).first()
    start = today if today.weekday() == 0 and not ran else today + timedelta(days=7 - today.weekday())
    return max(plan.start_day, start)


def recovery_days(distance_m: float) -> int:
    # Same windows the race integration uses after an A/B race.
    return 7 if distance_m >= 40000 else 4 if distance_m >= 20000 else 2


def _protected_days(session: Session, plan: Plan, start: date) -> set[date]:
    """Recovery days after races that are already behind us (they won't be folded in again)."""
    out: set[date] = set()
    for w in session.exec(select(PlannedWorkout).where(PlannedWorkout.plan_id == plan.id, PlannedWorkout.kind == "race",
                                                       PlannedWorkout.day < start)):
        r = session.get(GoalRace, w.race_id) if w.race_id else None
        if r is not None and r.priority == "C":
            continue
        for k in range(1, recovery_days(w.target_distance_m or 0) + 1):
            if w.day + timedelta(days=k) >= start:
                out.add(w.day + timedelta(days=k))
    return out


def regenerate(session: Session, plan: Plan, days_per_week: int, long_run_dow: int, peak_weekly_km: float | None,
               dry_run: bool = True, today: date | None = None) -> dict:
    """Rebuild future weeks with new settings; the past, finished/skipped workouts and races stay."""
    if not 3 <= days_per_week <= 7 or not 0 <= long_run_dow <= 6:
        raise ValueError("훈련 요일 설정을 확인해 주세요.")
    if peak_weekly_km is not None and not 15 <= peak_weekly_km <= 250:
        raise ValueError("최고 주간 거리는 15–250km 사이로 정해 주세요.")
    start = regen_from(session, plan, today)
    p = plan_params(session, plan)
    p.days_per_week, p.long_run_dow, p.peak_weekly_km = days_per_week, long_run_dow, peak_weekly_km
    workouts, weeks = gen.generate(p)

    existing = session.exec(select(PlannedWorkout).where(PlannedWorkout.plan_id == plan.id, PlannedWorkout.day >= start)).all()
    protected = _protected_days(session, plan, start)
    # Other races' days are rebuilt too and folded back in below (with their taper / recovery).
    keep = [w for w in existing if w.status != "planned" or w.day in protected]
    kept_days = {w.day for w in keep}
    drop = [w for w in existing if w not in keep]
    fresh = [w for w in workouts if w.day >= start and w.day not in kept_days]

    def week_of(d: date) -> str:
        return (d - timedelta(days=d.weekday())).isoformat()

    old_week: dict[str, float] = {}
    new_week: dict[str, float] = {}
    for w in drop:
        old_week[week_of(w.day)] = old_week.get(week_of(w.day), 0.0) + (w.target_distance_m or 0) / 1000
    for w in fresh:
        new_week[week_of(w.day)] = new_week.get(week_of(w.day), 0.0) + w.target_distance_m / 1000
    for w in keep:  # unchanged days count on both sides
        for side in (old_week, new_week):
            side[week_of(w.day)] = side.get(week_of(w.day), 0.0) + (w.target_distance_m or 0) / 1000
    phase = {wk["week_start"]: wk["phase"] for wk in weeks}
    summary = {
        "from_day": start.isoformat(),
        "replaced": len(drop),
        "created": len(fresh),
        "old_km": round(sum((w.target_distance_m or 0) for w in drop) / 1000, 1),
        "new_km": round(sum(w.target_distance_m for w in fresh) / 1000, 1),
        "weeks": [
            {"week_start": wk, "phase": phase.get(wk, "base"), "old_km": round(old_week.get(wk, 0), 1), "new_km": round(new_week.get(wk, 0), 1)}
            for wk in sorted(set(old_week) | set(new_week))
        ],
    }
    if dry_run:
        return summary

    for w in drop:
        session.delete(w)
    for w in fresh:
        session.add(PlannedWorkout(
            plan_id=plan.id, day=w.day, kind=w.kind, title=w.title, phase=w.phase,
            target_distance_m=w.target_distance_m, target_tss=w.target_tss, structure=w.structure, note=w.note,
            race_id=plan.goal_race_id if w.kind == "race" else None,
        ))
    plan.params = {**(plan.params or {}), "days_per_week": days_per_week, "long_run_dow": long_run_dow,
                   "peak_weekly_km": peak_weekly_km, "weeks": weeks}
    session.add(plan)
    session.commit()
    # Other saved races get their taper / recovery days again on the new layout.
    vdot = p.vdot
    for r in session.exec(select(GoalRace).where(GoalRace.id != plan.goal_race_id)).all():
        races_mod.apply(session, plan, r, vdot=vdot, today=today)
    return summary
