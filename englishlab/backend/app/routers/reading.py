"""Reading library, adaptive texts, tap-to-translate."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import select

from app.db import SessionDep
from app.learn import reading, words
from app.models import Reading

router = APIRouter(tags=["reading"])


@router.get("/readings")
def list_readings(session: SessionDep) -> list[dict]:
    rows = session.exec(select(Reading).order_by(Reading.id.desc()).limit(200)).all()
    return [reading.view(session, r, full=False) for r in rows]


class CreateBody(BaseModel):
    source_kind: str = Field(pattern="^(url|text|topic)$")
    url: str | None = None
    text: str | None = None
    topic: str | None = None
    mode: str = Field(default="auto", pattern="^(auto|adapt|gloss)$")
    length: str = Field(default="medium", pattern="^(short|medium|long)$")


@router.post("/readings")
def create(body: CreateBody, session: SessionDep) -> dict:
    r = reading.create(session, source_kind=body.source_kind, url=body.url, text=body.text, topic=body.topic,
                       mode=body.mode, length=body.length)
    return reading.view(session, r)


def _get(session, rid: int) -> Reading:
    r = session.get(Reading, rid)
    if not r:
        raise HTTPException(404, "읽기 자료를 찾을 수 없어요.")
    return r


@router.get("/readings/{rid}")
def get(rid: int, session: SessionDep) -> dict:
    return reading.view(session, _get(session, rid))


class FinishBody(BaseModel):
    minutes: float = Field(default=0, ge=0, le=300)
    listen_minutes: float = Field(default=0, ge=0, le=300)
    answers: list[int] | None = None
    known: list[str] = []
    unknown: list[str] = []
    quiz_mode: str = Field(default="read", pattern="^(read|listen)$")


@router.post("/readings/{rid}/finish")
def finish(rid: int, body: FinishBody, session: SessionDep) -> dict:
    return reading.finish(session, _get(session, rid), minutes=body.minutes, listen_minutes=body.listen_minutes,
                          answers=body.answers, known=body.known, unknown=body.unknown, quiz_mode=body.quiz_mode)


@router.post("/readings/{rid}/quickgloss")
def quickgloss(rid: int, session: SessionDep) -> dict:
    return {"meanings": reading.quick_gloss(session, _get(session, rid))}


@router.delete("/readings/{rid}")
def delete(rid: int, session: SessionDep) -> dict:
    session.delete(_get(session, rid))
    session.commit()
    return {"ok": True}


class GlossBody(BaseModel):
    term: str = Field(min_length=1, max_length=120)
    sentence: str = Field(default="", max_length=1200)


@router.post("/gloss")
def gloss(body: GlossBody, session: SessionDep) -> dict:
    return words.gloss(session, body.term, body.sentence or body.term)
