from datetime import date, timedelta

from fastapi import APIRouter
from sqlmodel import col, select

from app.db import SessionDep
from app.models import DailyWellness

router = APIRouter(tags=["wellness"])


@router.get("/wellness")
def list_wellness(session: SessionDep, days: int = 60) -> list[DailyWellness]:
    since = date.today() - timedelta(days=days)
    stmt = select(DailyWellness).where(DailyWellness.day >= since).order_by(col(DailyWellness.day))
    return list(session.exec(stmt))
