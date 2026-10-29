"""Routine modes (weekday / weekend / trip …) and reserved periods: mode switches and breaks (휴가)."""

from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlmodel import func, select

from app.db import SessionDep
from app.models import Habit, Mode, Period
from app.routine.book import mode_ids, today
from app.routine.service import mode_out, period_out

router = APIRouter(tags=["modes"])


@router.get("/modes")
def list_modes(session: SessionDep) -> dict:
    t = today(session)
    modes = session.exec(select(Mode).order_by(Mode.sort, Mode.id)).all()
    habits = session.exec(select(Habit).where(Habit.archived == False)).all()  # noqa: E712
    periods = session.exec(select(Period).where(Period.end >= t).order_by(Period.start, Period.id)).all()
    return {
        "modes": [{**mode_out(m), "habits": sum(1 for h in habits if not mode_ids(h) or m.id in mode_ids(h))} for m in modes],
        "periods": [period_out(p) for p in periods],
        "today": t.isoformat(),
    }


class ModeBody(BaseModel):
    name: str = Field(min_length=1, max_length=30)
    emoji: str = Field(default="🌤️", max_length=16)
    is_default: bool | None = None


@router.post("/modes")
def create_mode(body: ModeBody, session: SessionDep) -> dict:
    sort = (session.exec(select(func.max(Mode.sort))).one() or 0) + 1
    session.add(Mode(name=body.name.strip(), emoji=body.emoji, sort=sort))
    session.commit()
    return list_modes(session)


@router.put("/modes/{mode_id}")
def update_mode(mode_id: int, body: ModeBody, session: SessionDep) -> dict:
    m = session.get(Mode, mode_id)
    if not m:
        raise HTTPException(404, "없는 모드예요.")
    m.name, m.emoji = body.name.strip(), body.emoji
    if body.is_default:
        for other in session.exec(select(Mode).where(Mode.is_default)).all():
            other.is_default = False
            session.add(other)
        m.is_default = True
    session.add(m)
    session.commit()
    return list_modes(session)


@router.delete("/modes/{mode_id}")
def delete_mode(mode_id: int, session: SessionDep) -> dict:
    m = session.get(Mode, mode_id)
    if not m:
        return list_modes(session)
    if m.is_default:
        raise HTTPException(400, "기본 모드는 지울 수 없어요. 다른 모드를 기본으로 정한 뒤 지워 주세요.")
    for h in session.exec(select(Habit)).all():
        ids = mode_ids(h)
        if mode_id in ids:
            ids.discard(mode_id)
            h.modes = ",".join(map(str, sorted(ids)))
            session.add(h)
    session.delete(m)
    session.commit()
    return list_modes(session)


class PeriodBody(BaseModel):
    kind: Literal["mode", "break"]
    mode_id: int | None = None
    start: date
    end: date
    note: str = Field(default="", max_length=60)

    @model_validator(mode="after")
    def _check(self):
        if self.end < self.start:
            raise ValueError("끝나는 날이 시작하는 날보다 빨라요.")
        if self.kind == "mode" and self.mode_id is None:
            raise ValueError("어떤 모드로 바꿀지 골라 주세요.")
        return self


@router.post("/periods")
def create_period(body: PeriodBody, session: SessionDep) -> dict:
    if body.kind == "mode" and not session.get(Mode, body.mode_id):
        raise HTTPException(404, "없는 모드예요.")
    session.add(Period(kind=body.kind, mode_id=body.mode_id if body.kind == "mode" else None,
                       start=body.start, end=body.end, note=body.note.strip()))
    session.commit()
    return list_modes(session)


@router.delete("/periods/{period_id}")
def delete_period(period_id: int, session: SessionDep) -> dict:
    p = session.get(Period, period_id)
    if p:
        session.delete(p)
        session.commit()
    return list_modes(session)
