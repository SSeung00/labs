from datetime import date, datetime, timedelta

from fastapi import APIRouter
from pydantic import BaseModel
from sqlmodel import col, select

from app.analytics import condition as condition_mod
from app.analytics import load as load_mod
from app.analytics import readiness as readiness_mod
from app.analytics.metrics import recompute
from app.analytics.profile import ZONE_NAMES, effective_profile, latest_profile
from app.db import SessionDep
from app.models import Activity, AthleteProfile

router = APIRouter(tags=["analytics"])


@router.get("/profile")
def get_profile(session: SessionDep) -> dict:
    p = effective_profile(session)
    return {**p.as_dict(), "zone_names": ZONE_NAMES}


class ProfileBody(BaseModel):
    max_hr: float | None = None
    resting_hr: float | None = None
    lthr: float | None = None
    vdot: float | None = None
    hr_zone_method: str | None = None  # lthr | max
    zone_bounds: list[float] | None = None
    sex: str | None = None


@router.put("/profile")
def put_profile(body: ProfileBody, session: SessionDep) -> dict:
    prev = latest_profile(session)
    data = body.model_dump()
    row = AthleteProfile(
        effective_from=date.today(),
        max_hr=data["max_hr"],
        resting_hr=data["resting_hr"],
        lthr=data["lthr"],
        vdot=data["vdot"],
        hr_zone_method=data["hr_zone_method"] or (prev.hr_zone_method if prev else "lthr"),
        zone_bounds=data["zone_bounds"],
        sex=data["sex"] or (prev.sex if prev else "male"),
    )
    session.add(row)
    session.commit()
    # Zones and loads depend on the profile — recompute everything.
    recompute(session, force=True)
    return get_profile(session)


@router.get("/fitness/pmc")
def get_pmc(session: SessionDep, days: int = 180, project: int = 0) -> dict:
    from app.planner.service import planned_loads  # avoid import cycle at module load

    planned = planned_loads(session, date.today() + timedelta(days=1), date.today() + timedelta(days=project)) if project else None
    df = load_mod.pmc(session, days=days, planned=planned, project_days=project)
    return {"series": load_mod.as_records(df), "today": load_mod.today_state(session)}


@router.get("/fitness/weekly")
def get_weekly(session: SessionDep, weeks: int = 26) -> list[dict]:
    return load_mod.weekly(session, weeks)


@router.get("/fitness/efficiency")
def get_efficiency(session: SessionDep, days: int = 365) -> list[dict]:
    since = datetime.combine(date.today() - timedelta(days=days), datetime.min.time())
    rows = session.exec(
        select(Activity)
        .where(col(Activity.sport).contains("run"), Activity.start_time >= since, col(Activity.efficiency_factor).is_not(None))
        .order_by(col(Activity.start_time))
    ).all()
    return [
        {
            "id": a.id,
            "day": a.start_time.date().isoformat(),
            "name": a.name,
            "ef": round(a.efficiency_factor, 3) if a.efficiency_factor else None,
            "decoupling": round(a.decoupling_pct, 1) if a.decoupling_pct is not None else None,
            "avg_hr": a.avg_hr,
            "gap_speed": a.gap_speed_mps,
            "distance_m": a.distance_m,
            "moving_s": a.moving_time_s,
            "vdot_est": round(a.vdot_est, 1) if a.vdot_est else None,
            "load": round(a.load, 1) if a.load else None,
            "treadmill": "treadmill" in a.sport,
        }
        for a in rows
    ]


@router.get("/readiness")
def get_readiness(session: SessionDep, day: date | None = None) -> dict:
    return readiness_mod.compute(session, day)


@router.get("/condition")
def get_condition(session: SessionDep) -> dict:
    """Fitness / fatigue / form read as three signals plus a one-line diagnosis."""
    return condition_mod.compute(session)
