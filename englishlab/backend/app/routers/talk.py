"""AI conversation endpoints (voice or text turns)."""

import json

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlmodel import select

from app.db import SessionDep
from app.learn import srs, talk
from app.models import Conversation

router = APIRouter(prefix="/talk", tags=["talk"])


@router.get("/scenarios")
def scenarios() -> list[dict]:
    return [{"key": k, "title": v["title"], "desc": v["desc"]} for k, v in talk.SCENARIOS.items()]


@router.get("")
def list_convos(session: SessionDep) -> list[dict]:
    rows = session.exec(select(Conversation).order_by(Conversation.id.desc()).limit(200)).all()
    return [talk.convo_view(session, c) for c in rows]


class StartBody(BaseModel):
    scenario: str = "free"
    custom: str | None = Field(default=None, max_length=1000)
    reading_id: int | None = None


@router.post("")
def start(body: StartBody, session: SessionDep) -> dict:
    convo, first = talk.start(session, body.scenario, body.custom, body.reading_id)
    return {"conversation": talk.convo_view(session, convo, full=True), **first}


def _get(session, cid: int) -> Conversation:
    c = session.get(Conversation, cid)
    if not c:
        raise HTTPException(404, "대화를 찾을 수 없어요.")
    return c


@router.get("/{cid}")
def get(cid: int, session: SessionDep) -> dict:
    return talk.convo_view(session, _get(session, cid), full=True)


@router.post("/{cid}/transcribe")
def transcribe(cid: int, session: SessionDep, audio: UploadFile = File(...)) -> dict:
    _get(session, cid)
    return talk.transcribe(audio.file.read())


@router.post("/{cid}/turn")
def turn(cid: int, session: SessionDep, audio: UploadFile | None = File(default=None),
         text: str | None = Form(default=None), retry: bool = Form(default=False),
         stats: str | None = Form(default=None)) -> dict:
    """A turn from audio, or from text (typed, or already transcribed with its speech stats as JSON)."""
    data = audio.file.read() if audio is not None else None
    parsed = None
    if stats:
        try:
            parsed = json.loads(stats)
        except json.JSONDecodeError:
            parsed = None
    return talk.turn(session, _get(session, cid), text=text, audio=data, retry=retry, stats=parsed)


class HelpBody(BaseModel):
    korean: str = Field(min_length=1, max_length=500)


@router.post("/{cid}/help")
def help_say(cid: int, body: HelpBody, session: SessionDep) -> dict:
    return talk.help_say(session, _get(session, cid), body.korean)


@router.post("/{cid}/end")
def end(cid: int, session: SessionDep) -> dict:
    c = _get(session, cid)
    if c.ended_at:
        return {"report": c.report, "metrics": c.metrics}
    return talk.end(session, c)


class SaveExprBody(BaseModel):
    items: list[dict]


@router.post("/{cid}/cards")
def save_expressions(cid: int, body: SaveExprBody, session: SessionDep) -> dict:
    """Add chosen report expressions/upgrades as cards."""
    from app.learn import words

    _get(session, cid)
    made = []
    for it in body.items[:20]:
        term = (it.get("expr") or it.get("better") or "").strip()
        if not term:
            continue
        card = srs.create(session, term=term, kind="phrase" if " " in term else "word",
                          context=it.get("example") or it.get("better"), meaning_ko=it.get("meaning_ko"),
                          prompt=it.get("original"), source_kind="talk", source_id=cid)
        if not card.enriched:
            words.enrich_async(card.id)
        made.append(card.id)
    return {"created": made}


@router.delete("/{cid}")
def delete(cid: int, session: SessionDep) -> dict:
    session.delete(_get(session, cid))
    session.commit()
    return {"ok": True}
