"""Routines (habits): create, edit, reorder, archive; starter templates."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import func, select

from app.core import store
from app.db import SessionDep
from app.models import Habit, Mode
from app.routine.book import today
from app.routine.service import habit_out, mode_out
from app.routine.templates import THEMES

router = APIRouter(tags=["habits"])


class HabitBody(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    emoji: str = Field(default="✅", max_length=16)
    color: str = Field(default="green", max_length=16)
    category: Literal["health", "exercise", "study", "mind", "life"] = "life"
    slot: Literal["morning", "day", "evening", "night", "anytime"] = "anytime"
    kind: Literal["check", "count", "minutes", "number"] = "check"
    target: float = Field(default=1, gt=0, le=100000)
    unit: str = Field(default="", max_length=12)
    schedule: Literal["daily", "days", "weekly"] = "daily"
    days: list[int] = []
    per_week: int = Field(default=3, ge=1, le=7)
    easy_name: str = Field(default="", max_length=60)
    cue: str = Field(default="", max_length=60)
    reminder: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    modes: list[int] = []
    note: str = Field(default="", max_length=500)


def _apply(h: Habit, body: HabitBody) -> Habit:
    data = body.model_dump()
    days = sorted({d for d in data.pop("days") if 0 <= d <= 6})
    if body.schedule == "days" and not days:
        raise HTTPException(400, "요일을 하나 이상 골라 주세요.")
    modes = sorted(set(data.pop("modes")))
    for k, v in data.items():
        setattr(h, k, v.strip() if isinstance(v, str) else v)
    h.days = ",".join(map(str, days))
    h.modes = ",".join(map(str, modes))
    if h.kind == "check":
        h.target, h.unit = 1, ""
    return h


@router.get("/habits")
def list_habits(session: SessionDep) -> dict:
    habits = session.exec(select(Habit).order_by(Habit.archived, Habit.sort, Habit.id)).all()
    modes = session.exec(select(Mode).order_by(Mode.sort, Mode.id)).all()
    return {"habits": [habit_out(h) for h in habits], "modes": [mode_out(m) for m in modes]}


def _create(session, body: HabitBody, sort: int) -> Habit:
    h = _apply(Habit(name=body.name, start_date=today(session), sort=sort), body)
    session.add(h)
    return h


def _next_sort(session) -> int:
    return (session.exec(select(func.max(Habit.sort))).one() or 0) + 1


@router.post("/habits")
def create_habit(body: HabitBody, session: SessionDep) -> dict:
    h = _create(session, body, _next_sort(session))
    session.commit()
    session.refresh(h)
    return habit_out(h)


class BulkBody(BaseModel):
    habits: list[HabitBody] = Field(max_length=40)


@router.post("/habits/bulk")
def create_many(body: BulkBody, session: SessionDep) -> dict:
    start = _next_sort(session)
    for i, hb in enumerate(body.habits):
        _create(session, hb, start + i)
    session.commit()
    store.update_settings(session, {"onboarded": True})
    return list_habits(session)


@router.put("/habits/{habit_id}")
def update_habit(habit_id: int, body: HabitBody, session: SessionDep) -> dict:
    h = session.get(Habit, habit_id)
    if not h:
        raise HTTPException(404, "없는 루틴이에요.")
    _apply(h, body)
    session.add(h)
    session.commit()
    session.refresh(h)
    return habit_out(h)


class ArchiveBody(BaseModel):
    archived: bool


@router.post("/habits/{habit_id}/archive")
def archive_habit(habit_id: int, body: ArchiveBody, session: SessionDep) -> dict:
    h = session.get(Habit, habit_id)
    if not h:
        raise HTTPException(404, "없는 루틴이에요.")
    h.archived = body.archived
    h.archived_at = today(session) if body.archived else None
    session.add(h)
    session.commit()
    return habit_out(h)


@router.delete("/habits/{habit_id}")
def delete_habit(habit_id: int, session: SessionDep) -> dict:
    h = session.get(Habit, habit_id)
    if h:
        session.delete(h)
        session.commit()
    return {"ok": True}


class ReorderBody(BaseModel):
    ids: list[int]


@router.post("/habits/reorder")
def reorder(body: ReorderBody, session: SessionDep) -> dict:
    for i, hid in enumerate(body.ids):
        h = session.get(Habit, hid)
        if h:
            h.sort = i
            session.add(h)
    session.commit()
    return list_habits(session)


@router.get("/templates")
def templates() -> dict:
    return {"themes": THEMES}
