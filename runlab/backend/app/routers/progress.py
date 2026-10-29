from fastapi import APIRouter
from pydantic import BaseModel

from app.analytics import physio
from app.analytics import progress as P
from app.db import SessionDep

router = APIRouter(tags=["progress"])


@router.get("/progress")
def get_progress(session: SessionDep, goal_distance: float | None = None, goal_time: float | None = None) -> dict:
    pts = P.vdot_points(session)
    series = P.fitness_series(session)
    fit = P.fit_growth(series)
    cur = P.current_state(session, pts, series)
    cs = P.critical_speed(session)

    goal = None
    race = P.next_goal(session)
    if goal_distance and goal_time:
        goal = {"distance_m": goal_distance, "time_s": goal_time, "name": None, "race_day": None}
    elif race and race.target_time_s:
        goal = {"distance_m": race.distance_m, "time_s": race.target_time_s, "name": race.name, "race_day": race.race_day.isoformat()}
    if goal:
        goal["vdot"] = round(physio.vdot_from_race(goal["distance_m"], goal["time_s"]), 1)
        goal.update(P.goal_eta(fit, goal["vdot"]))

    public_fit = {k: v for k, v in fit.items() if k not in ("sims", "t0", "full_t", "current")}
    return {
        "points": [
            {
                "id": int(r.id),
                "day": r.day.date().isoformat(),
                "name": r.name,
                "vdot_hr": None if r.vdot_hr != r.vdot_hr else round(float(r.vdot_hr), 1),
                "vdot_perf": None if r.vdot_perf != r.vdot_perf else round(float(r.vdot_perf), 1),
                "vo2max": None if r.vo2max != r.vo2max else float(r.vo2max),
            }
            for r in pts.itertuples()
        ],
        "smooth": [{"day": d.date().isoformat(), "v": round(float(v), 2), "sd": round(float(sd), 2)}
                   for d, v, sd in zip(series["day"], series["v"], series["sd"], strict=True)],
        "fit": public_fit,
        "current": cur,
        "critical_speed": cs,
        "predictions": P.predictions(session, cur["vdot"], cs),
        "paces": physio.training_paces(cur["vdot"]) if cur["vdot"] else None,
        "goal": goal,
        "scenarios": P.plan_scenarios(session, cur["vdot"], series),
    }


@router.get("/progress/backtest")
def get_backtest(session: SessionDep) -> dict:
    """How well the fitness estimate predicted past all-out races (new method vs the original one)."""
    from app.analytics.vdot_filter import backtest

    return backtest(session, P.smooth_series_legacy(P.vdot_points(session)))


@router.get("/reflection")
def get_reflection(session: SessionDep, activity_id: int | None = None) -> dict | None:
    """What a run (default: the latest) changed in fitness, predictions, load and the plan."""
    from app.analytics.snapshots import reflection

    return reflection(session, activity_id)


@router.get("/snapshots")
def get_snapshots(session: SessionDep, days: int = 180) -> list[dict]:
    from app.analytics.snapshots import ensure_today, history

    ensure_today(session)
    return [s.model_dump() for s in history(session, days)]


@router.get("/progress/prs")
def get_prs(session: SessionDep) -> list[dict]:
    return P.personal_records(session)


class VdotQuery(BaseModel):
    distance_m: float
    time_s: float


@router.post("/progress/vdot")
def calc_vdot(body: VdotQuery) -> dict:
    v = physio.vdot_from_race(body.distance_m, body.time_s)
    return {
        "vdot": round(v, 1),
        "equivalents": [{"distance_m": d, "label": label, "time_s": round(physio.race_time_for_vdot(d, v))} for d, label in P.RACE_DISTANCES],
        "paces": physio.training_paces(v),
    }
