"""Planner queries: planned load for the PMC, plan-vs-actual matching, adaptive suggestions."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlmodel import Session, col, select

from app.models import Activity, Plan, PlannedWorkout

QUALITY_KINDS = {"tempo", "interval", "mp", "race"}


def load_calibration(session: Session) -> float:
    """Planned TSS uses textbook intensity factors; scale it to this athlete's measured load.

    Ratio of median measured load per hour on recent easy runs to the planner's easy-run rate.
    """
    since = datetime.combine(date.today() - timedelta(days=120), datetime.min.time())
    rows = session.exec(
        select(Activity.load, Activity.moving_time_s).where(
            Activity.run_type == "easy", Activity.load_source == "hr", Activity.start_time >= since
        )
    ).all()
    rates = [ld / (t / 3600) for ld, t in rows if ld and t and t > 1200]
    if len(rates) < 5:
        return 1.0
    planned_easy_rate = 0.72**2 * 100
    rates.sort()
    return max(0.5, min(1.5, rates[len(rates) // 2] / planned_easy_rate))


def planned_loads(session: Session, start: date, end: date, calibrate: bool = True) -> dict[date, float]:
    """Expected training load per future day from the active plan(s)."""
    rows = session.exec(
        select(PlannedWorkout.day, PlannedWorkout.target_tss)
        .join(Plan, col(Plan.id) == col(PlannedWorkout.plan_id))
        .where(Plan.active.is_(True), PlannedWorkout.day >= start, PlannedWorkout.day <= end)
    ).all()
    k = load_calibration(session) if calibrate else 1.0
    out: dict[date, float] = {}
    for d, tss in rows:
        out[d] = out.get(d, 0.0) + float(tss or 0) * k
    return out


def active_plan(session: Session) -> Plan | None:
    return session.exec(select(Plan).where(Plan.active.is_(True)).order_by(col(Plan.id).desc())).first()


def runs_by_day(session: Session, start: date, end: date) -> dict[date, list[Activity]]:
    rows = session.exec(
        select(Activity).where(
            col(Activity.sport).contains("run"),
            Activity.start_time >= datetime.combine(start, datetime.min.time()),
            Activity.start_time < datetime.combine(end + timedelta(days=1), datetime.min.time()),
        )
    ).all()
    out: dict[date, list[Activity]] = {}
    for a in rows:
        out.setdefault(a.start_time.date(), []).append(a)
    return out


def match_status(w: PlannedWorkout, runs: list[Activity], today: date) -> tuple[str, int | None, float]:
    """(status, matched activity id, actual km). Manual 'skipped' wins."""
    km = sum(a.distance_m for a in runs) / 1000
    main = max(runs, key=lambda a: a.distance_m) if runs else None
    if w.status == "skipped":
        return "skipped", main.id if main else None, km
    if w.kind == "rest":
        return "rest", None, km
    if runs:
        target = (w.target_distance_m or 0) / 1000
        if not target or km >= 0.75 * target:
            return "done", main.id, km
        return "partial", main.id, km
    if w.day < today:
        return "missed", None, 0.0
    return "planned", None, 0.0


def plan_view(session: Session, plan: Plan) -> dict:
    today = date.today()
    workouts = session.exec(
        select(PlannedWorkout).where(PlannedWorkout.plan_id == plan.id).order_by(col(PlannedWorkout.day))
    ).all()
    runs = runs_by_day(session, plan.start_day, max(plan.end_day, today))
    items = []
    done = due = 0
    weeks: dict[str, dict] = {}
    for w in workouts:
        day_runs = runs.get(w.day, [])
        status, aid, km = match_status(w, day_runs, today)
        main = next((a for a in day_runs if a.id == aid), None)
        items.append({**w.model_dump(), "status": status, "matched_activity_id": aid, "actual_km": round(km, 2),
                      "actual_time_s": round(main.moving_time_s or main.duration_s) if main else None,
                      "actual_main_km": round(main.distance_m / 1000, 2) if main else None})
        if w.day <= today and w.kind != "rest":
            due += 1
            done += status == "done"
        wk = (w.day - timedelta(days=w.day.weekday())).isoformat()
        b = weeks.setdefault(wk, {"week_start": wk, "phase": w.phase, "planned_km": 0.0, "actual_km": 0.0, "planned_tss": 0.0})
        b["planned_km"] += (w.target_distance_m or 0) / 1000
        b["planned_tss"] += w.target_tss or 0

    # Actual km per plan week (all runs, not just matched ones).
    for d, acts in runs.items():
        wk = (d - timedelta(days=d.weekday())).isoformat()
        if wk in weeks and d <= today:
            weeks[wk]["actual_km"] += sum(a.distance_m for a in acts) / 1000

    # Runs on days with nothing planned (shown on the calendar as extras).
    planned_days = {w.day for w in workouts}
    extras = [
        {"day": d.isoformat(), "activity_id": a.id, "km": round(a.distance_m / 1000, 2), "name": a.name}
        for d, acts in runs.items() if d not in planned_days and plan.start_day <= d <= today
        for a in acts
    ]
    return {
        "plan": plan,
        "workouts": items,
        "weeks": [{**v, "planned_km": round(v["planned_km"], 1), "actual_km": round(v["actual_km"], 1), "planned_tss": round(v["planned_tss"])} for v in weeks.values()],
        "extras": extras,
        "compliance": round(done / due, 3) if due else None,
        "done": done,
        "due": due,
    }


def suggestions(session: Session, readiness: dict) -> list[dict]:
    """Rule-based nudges for today/tomorrow. The user applies them; nothing changes automatically."""
    plan = active_plan(session)
    if not plan:
        return []
    today = date.today()
    upcoming = session.exec(
        select(PlannedWorkout).where(
            PlannedWorkout.plan_id == plan.id, PlannedWorkout.day >= today, PlannedWorkout.day <= today + timedelta(days=1)
        ).order_by(col(PlannedWorkout.day))
    ).all()
    out = []
    level = readiness.get("level")
    for w in upcoming:
        if w.kind not in QUALITY_KINDS or w.kind == "race" or w.status == "skipped":
            continue
        if level in ("low", "very_low") and w.day == today:
            out.append({
                "workout_id": w.id,
                "severity": "high" if level == "very_low" else "medium",
                "title": f"오늘 '{w.title}' 대신 이지런을 권해요",
                "reason": f"준비도 {readiness['score']}점 · " + (readiness["flags"][0] if readiness.get("flags") else "회복이 덜 됐어요"),
                "actions": [
                    {"type": "convert_easy", "label": "이지런으로 바꾸기"},
                    {"type": "move_tomorrow", "label": "내일로 미루기"},
                ],
            })
        elif (readiness.get("load", {}).get("acwr") or 0) > 1.5 and w.day <= today + timedelta(days=1):
            out.append({
                "workout_id": w.id,
                "severity": "medium",
                "title": "부하가 급격히 늘었어요",
                "reason": f"ACWR {readiness['load']['acwr']:.2f} — 이번 품질 훈련 거리를 줄이는 걸 고려하세요",
                "actions": [{"type": "convert_easy", "label": "이지런으로 바꾸기"}],
            })
    # Missed key workout yesterday → offer to move it.
    y = session.exec(
        select(PlannedWorkout).where(PlannedWorkout.plan_id == plan.id, PlannedWorkout.day == today - timedelta(days=1))
    ).first()
    if y and y.kind in QUALITY_KINDS and y.kind != "race":
        st, _, _ = match_status(y, runs_by_day(session, y.day, y.day).get(y.day, []), today)
        if st == "missed" and level in ("high", "ok"):
            out.append({
                "workout_id": y.id,
                "severity": "low",
                "title": f"어제 '{y.title}'을(를) 놓쳤어요",
                "reason": "컨디션이 괜찮다면 오늘 하고, 오늘 계획은 이지로 바꿔도 돼요",
                "actions": [{"type": "move_today", "label": "오늘로 옮기기"}, {"type": "skip", "label": "건너뛰기"}],
            })
    return out


def easy_version(w: PlannedWorkout) -> None:
    """Turn a workout into an easy run ~80% of its distance (min 4 km)."""
    km = max(4.0, round((w.target_distance_m or 6000) / 1000 * 0.8 * 2) / 2)
    w.kind, w.title = "easy", f"이지런 {km:g}km"
    w.target_distance_m = km * 1000
    w.structure = [{"type": "run", "distance_m": km * 1000, "pace": "E"}]
    w.target_tss = round(km * 5.4 / 60 * 0.72**2 * 100, 1)  # ~5:24/km easy
