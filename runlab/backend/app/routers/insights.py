from fastapi import APIRouter

from app.analytics import findings as findings_mod
from app.analytics import insights as I
from app.db import SessionDep

router = APIRouter(tags=["insights"])


@router.get("/insights/metrics")
def metrics(session: SessionDep) -> list[dict]:
    df = I.daily_frame(session, 365)
    cat = I.metric_catalog(session)
    for m in cat:
        m["count"] = int(df[m["key"]].notna().sum()) if m["key"] in df else 0
    return cat


@router.get("/insights/correlate")
def correlate(session: SessionDep, x: str, y: str, lag: int = 0, days: int = 365) -> dict:
    df = I.daily_frame(session, days)
    return I.correlate(df, x, y, max(0, min(lag, 7)))


@router.get("/insights/drivers")
def drivers(session: SessionDep, target: str, days: int = 365) -> list[dict]:
    df = I.daily_frame(session, days)
    return I.drivers(df, target, I.metric_catalog(session))


@router.get("/insights/heat")
def heat(session: SessionDep) -> dict:
    return I.heat_effect(session)


@router.get("/insights/findings")
def findings(session: SessionDep) -> list[dict]:
    """The clearest relationships in the data, as ready-to-read sentences."""
    return findings_mod.compute(session)
