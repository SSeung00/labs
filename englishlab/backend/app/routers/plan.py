"""Study plan, skill estimate and forecast, books."""

from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import select

from app.db import SessionDep
from app.learn import books, forecast, levels, plan
from app.models import Book, StudyPlan

router = APIRouter(tags=["plan"])


@router.get("/plan")
def get_plan(session: SessionDep) -> dict:
    act = plan.active(session)
    gen = plan.generating(session)
    failed = session.exec(select(StudyPlan).where(StudyPlan.status == "error").order_by(StudyPlan.id.desc())).first()
    return {
        "plan": plan.view(act) if act else None,
        "generating": plan.view(gen) if gen else None,
        "failed": plan.view(failed) if failed and (not act or failed.id > act.id) and not gen else None,
        "track": plan.track(session, act) if act else None,
        "forecast": None if act else forecast.forecast(session),
        "levels": levels.current(session),
        "checkin": (act.checkins or {}).get("{}-W{:02d}".format(*date.today().isocalendar()[:2])) if act else None,
    }


class PlanBody(BaseModel):
    note: str | None = Field(default=None, max_length=500)


@router.post("/plan")
def make_plan(body: PlanBody, session: SessionDep) -> dict:
    return plan.view(plan.start_generation(session, body.note))


@router.delete("/plan/failed")
def dismiss_failed(session: SessionDep) -> dict:
    for row in session.exec(select(StudyPlan).where(StudyPlan.status == "error")).all():
        session.delete(row)
    session.commit()
    return {"ok": True}


class CheckinBody(BaseModel):
    force: bool = False


@router.post("/plan/checkin")
def checkin(body: CheckinBody, session: SessionDep) -> dict:
    act = plan.active(session)
    if not act:
        raise HTTPException(400, "먼저 공부 계획을 만들어 주세요.")
    return plan.checkin(session, act, force=body.force)


@router.get("/forecast")
def get_forecast(session: SessionDep) -> dict:
    return forecast.forecast(session)


class LevelBody(BaseModel):
    skill: str = Field(pattern="^(reading|listening|speaking|writing)$")
    level: float = Field(ge=1, le=6)
    source: str = Field(default="mock", pattern="^(mock|manual)$")
    note: str | None = Field(default=None, max_length=120)


@router.post("/levels/evidence")
def add_evidence(body: LevelBody, session: SessionDep) -> dict:
    """An outside result, e.g. an official or mock TOEFL section band."""
    levels.record(session, body.skill, body.level, body.source, note=body.note)
    return levels.current(session)


# ---------- books ----------

def _book(session, bid: int) -> Book:
    b = session.get(Book, bid)
    if not b:
        raise HTTPException(404, "교재를 찾을 수 없어요.")
    return b


@router.get("/books")
def list_books(session: SessionDep) -> list[dict]:
    return [books.view(session, b) for b in session.exec(select(Book).order_by(Book.id.desc())).all()]


class BookBody(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    author: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=600)


@router.post("/books")
def add_book(body: BookBody, session: SessionDep) -> dict:
    return books.view(session, books.create(session, body.title, body.author, body.notes), full=True)


@router.get("/books/{bid}")
def get_book(bid: int, session: SessionDep) -> dict:
    return books.view(session, _book(session, bid), full=True)


@router.post("/books/{bid}/retry")
def retry_book(bid: int, session: SessionDep) -> dict:
    return books.view(session, books.retry(session, _book(session, bid)), full=True)


class ActivateBody(BaseModel):
    start: date | None = None
    days_per_week: int | None = Field(default=None, ge=1, le=7)
    minutes_per_session: int | None = Field(default=None, ge=10, le=240)


@router.post("/books/{bid}/activate")
def activate_book(bid: int, body: ActivateBody, session: SessionDep) -> dict:
    b = _book(session, bid)
    if b.status in ("researching",):
        raise HTTPException(400, "조사가 끝난 뒤에 계획에 넣을 수 있어요.")
    if not b.units:
        raise HTTPException(400, "목차(단원)가 없어서 일정을 만들 수 없어요. 단원을 먼저 추가해 주세요.")
    return books.view(session, books.activate(session, b, start=body.start, days_per_week=body.days_per_week,
                                              minutes_per_session=body.minutes_per_session), full=True)


class BookEdit(BaseModel):
    status: str | None = Field(default=None, pattern="^(active|paused|ready|done)$")
    title: str | None = Field(default=None, max_length=200)
    units_done: list[int] | None = None
    units: list[dict] | None = None
    unit_label: str | None = Field(default=None, max_length=20)


@router.patch("/books/{bid}")
def edit_book(bid: int, body: BookEdit, session: SessionDep) -> dict:
    b = _book(session, bid)
    if body.title:
        b.title = body.title.strip()
    if body.unit_label:
        b.unit_label = body.unit_label.strip()
    if body.units is not None:
        b.units = [{"title": str(u.get("title") or "").strip()[:120] or f"{b.unit_label} {i + 1}",
                    "minutes": max(5, min(240, int(u.get("minutes") or 45)))} for i, u in enumerate(body.units[:120])]
        b.units_done = [i for i in (b.units_done or []) if i < len(b.units)]
    if body.units_done is not None:
        b.units_done = sorted({i for i in body.units_done if 0 <= i < len(b.units)})
    if body.status:
        if body.status == "active" and not b.start_date:
            books.activate(session, b)
        b.status = body.status
    session.add(b)
    session.commit()
    return books.view(session, b, full=True)


class SessionBody(BaseModel):
    minutes: float = Field(ge=0, le=600)
    units: list[int] = []
    score: float | None = Field(default=None, ge=0, le=1)
    band: float | None = Field(default=None, ge=1, le=6)
    note: str | None = Field(default=None, max_length=300)


@router.post("/books/{bid}/sessions")
def log_book_session(bid: int, body: SessionBody, session: SessionDep) -> dict:
    b = _book(session, bid)
    if b.status == "researching":
        raise HTTPException(400, "조사가 끝난 뒤에 기록할 수 있어요.")
    books.log_session(session, b, minutes=body.minutes, units=body.units, score=body.score, band=body.band,
                      note=body.note)
    return books.view(session, b, full=True)


@router.delete("/books/{bid}")
def delete_book(bid: int, session: SessionDep) -> dict:
    session.delete(_book(session, bid))
    session.commit()
    return {"ok": True}
