"""Daily fitness snapshots and the "what this run changed" reflection.

A snapshot stores the day's fitness, load, race predictions and the goal outlook (chance of reaching the
goal race's target if the plan keeps being followed as it has been). The reflection compares the fitness
estimate before and after one run, so a good session visibly moves the numbers.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta

import pandas as pd
from sqlmodel import Session, col, select

from app.analytics import physio
from app.analytics import progress as P
from app.analytics.load import pmc
from app.models import Activity, FitnessSnapshot, GoalRace, PlannedWorkout

DISTANCES = [5000, 10000, 21097.5, 42195]
GROWTH_SD_PER_SQRT_WEEK = 0.35  # how much less sure race-day fitness is, the further away it is


def _phi(z: float) -> float:
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def goal_outlook(session: Session, vdot: float | None, sd: float | None, series: pd.DataFrame, today: date) -> dict | None:
    race = P.next_goal(session)
    if not race or not vdot:
        return None
    out: dict = {"race_id": race.id, "name": race.name, "race_day": race.race_day.isoformat(), "distance_m": race.distance_m,
                 "target_s": race.target_time_s, "predicted_now_s": round(physio.race_time_for_vdot(race.distance_m, vdot))}
    scen = P.plan_scenarios(session, vdot, series)
    if scen and scen.get("race_day") == race.race_day.isoformat():
        # The scenario at the compliance actually achieved so far (or the plan as written).
        items = scen["scenarios"]
        actual = next((s for s in items if "이행률" in s["label"]), None) or items[0]
        race_v = actual["race_day_vdot"]
        out["predicted_race_day_s"] = actual.get("predicted_time_s")
    else:
        race_v = vdot
    if race.target_time_s:
        goal_v = physio.vdot_from_race(race.distance_m, race.target_time_s)
        weeks = max((race.race_day - today).days / 7, 0)
        total_sd = math.sqrt((sd or 1.0) ** 2 + GROWTH_SD_PER_SQRT_WEEK ** 2 * weeks)
        out["goal_vdot"] = round(goal_v, 1)
        out["race_day_vdot"] = round(race_v, 1)
        out["chance"] = round(1 - _phi((goal_v - race_v) / total_sd), 3)
    return out


def record(session: Session, day: date | None = None) -> FitnessSnapshot:
    """Upsert today's snapshot from the current estimates."""
    day = day or date.today()
    series = P.fitness_series(session)
    cur = P.current_state(session, P.vdot_points(session), series)
    vdot, sd = cur["vdot"], cur["vdot_sd"]
    load = pmc(session, days=1)
    last = load.iloc[-1] if len(load) else None
    snap = session.get(FitnessSnapshot, day) or FitnessSnapshot(day=day)
    snap.vdot, snap.vdot_sd = vdot, sd
    if last is not None:
        snap.ctl, snap.atl, snap.tsb = round(float(last["ctl"]), 1), round(float(last["atl"]), 1), round(float(last["tsb"]), 1)
    snap.predictions = {str(d): round(physio.race_time_for_vdot(d, vdot)) for d in DISTANCES} if vdot else None
    snap.goal = goal_outlook(session, vdot, sd, series, day)
    snap.updated_at = datetime.now()
    session.add(snap)
    session.commit()
    session.refresh(snap)
    return snap


def ensure_today(session: Session) -> FitnessSnapshot:
    snap = session.get(FitnessSnapshot, date.today())
    return snap if snap is not None else record(session)


def history(session: Session, days: int = 180) -> list[FitnessSnapshot]:
    since = date.today() - timedelta(days=days)
    return list(session.exec(select(FitnessSnapshot).where(FitnessSnapshot.day >= since).order_by(col(FitnessSnapshot.day))))


# ---------- reflection ----------

def _value_on(series: pd.DataFrame, day: date) -> tuple[float | None, float | None]:
    s = series.set_index("day")
    ts = pd.Timestamp(day)
    if ts not in s.index:
        return None, None
    return float(s.loc[ts, "v"]), float(s.loc[ts, "sd"])


def reflection(session: Session, activity_id: int | None = None) -> dict | None:
    """What one run changed: fitness before → after, goal-race prediction, load, and the plan."""
    if activity_id:
        a = session.get(Activity, activity_id)
    else:
        a = session.exec(select(Activity).where(col(Activity.sport).contains("run")).order_by(col(Activity.start_time).desc())).first()
    if a is None or "run" not in (a.sport or ""):
        return None
    day = a.start_time.date()
    series = P.fitness_series(session)
    before, _ = _value_on(series, day - timedelta(days=1))
    after, sd_after = _value_on(series, day)
    out: dict = {"activity_id": a.id, "name": a.name, "day": day.isoformat(), "run_type": a.run_type,
                 "km": round(a.distance_m / 1000, 2), "vdot_before": None if before is None else round(before, 1),
                 "vdot_after": None if after is None else round(after, 1), "vdot_sd": None if sd_after is None else round(sd_after, 1)}

    race = session.exec(select(GoalRace).where(GoalRace.race_day >= day).order_by(col(GoalRace.priority), col(GoalRace.race_day))).first()
    if race and before and after:
        out["race"] = {"name": race.name, "distance_m": race.distance_m, "target_s": race.target_time_s,
                       "before_s": round(physio.race_time_for_vdot(race.distance_m, before)),
                       "after_s": round(physio.race_time_for_vdot(race.distance_m, after))}

    load = pmc(session, days=max(3, (date.today() - day).days + 2))
    ts_before, ts_day = pd.Timestamp(day - timedelta(days=1)), pd.Timestamp(day)
    if ts_before in load.index and ts_day in load.index:
        out["ctl_delta"] = round(float(load.loc[ts_day, "ctl"] - load.loc[ts_before, "ctl"]), 1)
        out["tsb_after"] = round(float(load.loc[ts_day, "ctl"] - load.loc[ts_day, "atl"]), 1)
    out["load"] = round(a.load, 0) if a.load else None

    # The plan: the workout this run matched, how it went, and the week so far.
    from app.planner.review import review
    from app.planner.service import active_plan, plan_view

    plan = active_plan(session)
    if plan:
        w = session.exec(select(PlannedWorkout).where(PlannedWorkout.plan_id == plan.id, PlannedWorkout.day == day,
                                                      PlannedWorkout.kind != "rest")).first()
        if w:
            rv = review(session, w)
            act = rv.get("actual") or {}
            out["workout"] = {"id": w.id, "title": w.title, "kind": w.kind, "main_zone": rv["main_zone"],
                              "verdict": act.get("main_verdict"), "target_km": act.get("target_km"),
                              "reps_on": sum(1 for r in act.get("reps", []) if r["verdict"] == "on"), "reps": len(act.get("reps", []))}
        view = plan_view(session, plan)
        monday = (day - timedelta(days=day.weekday())).isoformat()
        wk = next((x for x in view["weeks"] if x["week_start"] == monday), None)
        if wk:
            planned_to_date = sum((x["target_distance_m"] or 0) / 1000 for x in view["workouts"]
                                  if monday <= (x["day"].isoformat() if isinstance(x["day"], date) else x["day"]) <= day.isoformat())
            out["week"] = {"actual_km": wk["actual_km"], "planned_km": wk["planned_km"],
                           "planned_to_date_km": round(planned_to_date, 1)}
    return out
