"""The day: today's payload, routine check-ins, todos and the reflection journal."""

from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlmodel import select

from app.db import SessionDep
from app.models import DayLog, Period, Todo
from app.routine import service
from app.routine.book import Book, today

router = APIRouter(tags=["day"])


@router.get("/today")
def get_day(session: SessionDep, day: date | None = None) -> dict:
    return service.day_payload(session, day)


class EntryBody(BaseModel):
    habit_id: int
    day: date
    value: float | None = Field(default=None, ge=0, le=1_000_000)
    state: Literal["", "done", "easy", "skip"] | None = None
    note: str | None = Field(default=None, max_length=500)


@router.put("/entries")
def put_entry(body: EntryBody, session: SessionDep) -> dict:
    service.set_entry(session, body.habit_id, body.day, value=body.value, state=body.state, note=body.note)
    return service.day_payload(session, body.day)


class QuickBody(BaseModel):
    habit_id: int
    action: Literal["done", "easy"] = "done"


@router.post("/entries/quick")
def quick(body: QuickBody, session: SessionDep) -> dict:
    """Used by the notification buttons (the service worker posts here)."""
    service.quick_check(session, body.habit_id, body.action)
    return {"ok": True}


# ---------- mode / rest for one day ----------

class DayModeBody(BaseModel):
    day: date
    mode_id: int | None = None  # None = back to whatever the calendar says


def _clear_single(session, d: date, kind: str) -> None:
    for p in session.exec(select(Period).where(Period.start == d, Period.end == d, Period.kind == kind)).all():
        session.delete(p)


@router.put("/day/mode")
def set_day_mode(body: DayModeBody, session: SessionDep) -> dict:
    _clear_single(session, body.day, "mode")
    if body.mode_id is not None:
        session.add(Period(kind="mode", mode_id=body.mode_id, start=body.day, end=body.day, note="오늘만"))
    session.commit()
    return service.day_payload(session, body.day)


class DayRestBody(BaseModel):
    day: date
    rest: bool


@router.put("/day/rest")
def set_day_rest(body: DayRestBody, session: SessionDep) -> dict:
    _clear_single(session, body.day, "break")
    if body.rest:
        session.add(Period(kind="break", start=body.day, end=body.day, note="쉬는 날"))
    session.commit()
    return service.day_payload(session, body.day)


# ---------- todos ----------

class TodoBody(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    day: date | None = None
    time: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$|^$")
    done: bool | None = None
    sort: int | None = None


@router.put("/todos/{todo_id}")
def put_todo(todo_id: str, body: TodoBody, session: SessionDep) -> dict:
    t = service.upsert_todo(session, todo_id[:64], body.model_dump(exclude_unset=True))
    return service.day_payload(session, t.day)


@router.delete("/todos/{todo_id}")
def delete_todo(todo_id: str, session: SessionDep) -> dict:
    t = session.get(Todo, todo_id)
    d = t.day if t else today(session)
    if t:
        session.delete(t)
        session.commit()
    return service.day_payload(session, d)


class CarryBody(BaseModel):
    day: date


@router.post("/todos/carry")
def carry(body: CarryBody, session: SessionDep) -> dict:
    service.carry_over(session, body.day)
    return service.day_payload(session, body.day)


# ---------- journal ----------

class LogBody(BaseModel):
    mood: int | None = Field(default=None, ge=1, le=5)
    energy: int | None = Field(default=None, ge=1, le=5)
    sleep_hours: float | None = Field(default=None, ge=0, le=24)
    weight: float | None = Field(default=None, ge=20, le=300)
    answers: dict[str, str] | None = None
    note: str | None = Field(default=None, max_length=5000)


@router.put("/journal/{day}")
def put_log(day: date, body: LogBody, session: SessionDep) -> dict:
    service.put_log(session, day, body.model_dump(exclude_unset=True))
    return service.day_payload(session, day)


@router.get("/journal")
def journal(session: SessionDep, before: date | None = None, limit: int = 30) -> dict:
    limit = max(1, min(100, limit))
    q = select(DayLog).order_by(DayLog.day.desc()).limit(limit)
    if before:
        q = q.where(DayLog.day < before)
    logs = session.exec(q).all()
    if not logs:
        return {"entries": [], "more": False}
    book = Book(session, logs[-1].day - timedelta(days=7), logs[0].day)
    entries = []
    for log in logs:
        r = book.day(log.day)
        entries.append({
            **service.log_out(log, log.day),
            "signal": service.signal_out(r),
            "done": [f"{i.habit.emoji} {i.habit.name}" for i in r.items if i.done],
            "mode": service.mode_out(r.mode),
        })
    return {"entries": entries, "more": len(logs) == limit}
