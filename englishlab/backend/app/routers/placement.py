"""Placement test endpoints. Sections can be done in any order; finish asks Opus for the verdict."""

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlmodel import select

from app.core import speech
from app.db import SessionDep
from app.learn import placement
from app.models import Placement

router = APIRouter(prefix="/placement", tags=["placement"])


def _get(session, pid: int) -> Placement:
    pl = session.get(Placement, pid)
    if not pl:
        raise HTTPException(404, "진단을 찾을 수 없어요.")
    return pl


def _save(session, pl: Placement, section: str, value: dict) -> None:
    pl.answers = {**pl.answers, section: value}
    session.add(pl)
    session.commit()


@router.get("")
def list_placements(session: SessionDep) -> list[dict]:
    rows = session.exec(select(Placement).order_by(Placement.id.desc())).all()
    return [{"id": p.id, "created_at": p.created_at.isoformat(timespec="minutes"),
             "finished_at": p.finished_at.isoformat(timespec="minutes") if p.finished_at else None,
             "levels": (p.result or {}).get("levels")} for p in rows]


@router.post("")
def start(session: SessionDep) -> dict:
    return placement.view(placement.start(session))


@router.get("/{pid}")
def get(pid: int, session: SessionDep) -> dict:
    return placement.view(_get(session, pid))


@router.post("/{pid}/retry")
def retry(pid: int, session: SessionDep) -> dict:
    return placement.view(placement.retry(session, _get(session, pid)))


@router.delete("/{pid}")
def discard(pid: int, session: SessionDep) -> dict:
    """Drop an unfinished test (finished ones are kept as level history)."""
    pl = _get(session, pid)
    if pl.finished_at:
        raise HTTPException(400, "끝난 진단은 지울 수 없어요.")
    session.delete(pl)
    session.commit()
    return {"ok": True}


class VocabBody(BaseModel):
    answers: dict[str, bool]


@router.post("/{pid}/vocab")
def vocab(pid: int, body: VocabBody, session: SessionDep) -> dict:
    pl = _get(session, pid)
    score = placement.score_vocab(pl, body.answers)
    _save(session, pl, "vocab", {"answers": body.answers, "score": score})
    return score


class ReadingBody(BaseModel):
    answers: list[list[int]]


@router.post("/{pid}/reading")
def reading(pid: int, body: ReadingBody, session: SessionDep) -> dict:
    pl = _get(session, pid)
    score = placement.score_reading(pl, body.answers)
    _save(session, pl, "reading", {"answers": body.answers, "score": score})
    return {"estimate": score["estimate"], "passages": score["passages"]}


@router.post("/{pid}/dictation/{index}/audio")
def dictation_audio(pid: int, index: int, session: SessionDep) -> dict:
    pl = _get(session, pid)
    try:
        text = placement.dictation_text(pl, index)
    except (KeyError, IndexError) as e:
        raise HTTPException(404, "문장이 없어요.") from e
    rate = -10 if index < 3 else 0  # the easiest sentences a little slower
    return speech.synthesize(text, None, rate)


class ListeningBody(BaseModel):
    answers: list[str]


@router.post("/{pid}/listening")
def listening(pid: int, body: ListeningBody, session: SessionDep) -> dict:
    pl = _get(session, pid)
    score = placement.score_dictation(pl, body.answers)
    _save(session, pl, "listening", {"answers": body.answers, "score": score})
    return score


@router.post("/{pid}/speaking/{index}")
def speaking(pid: int, index: int, session: SessionDep, audio: UploadFile = File(...)) -> dict:
    pl = _get(session, pid)
    prompts = pl.material.get("speaking") or []
    if index >= len(prompts):
        raise HTTPException(404, "문항이 없어요.")
    tr = speech.transcribe(audio.file.read())
    items = list((pl.answers.get("speaking") or {}).get("items", []))
    while len(items) <= index:
        items.append({})
    items[index] = {"prompt": prompts[index]["prompt"], "text": tr.text, "stats": tr.stats()}
    session.refresh(pl)
    _save(session, pl, "speaking", {"items": items})
    return items[index]


class SelfBody(BaseModel):
    answers: dict[str, bool]


@router.post("/{pid}/self")
def self_assessment(pid: int, body: SelfBody, session: SessionDep) -> dict:
    """CEFR can-do statements the learner ticked while the test material was being made."""
    pl = _get(session, pid)
    _save(session, pl, "self", {"answers": body.answers})
    return {"ok": True}


class WritingBody(BaseModel):
    text: str


@router.post("/{pid}/writing")
def writing(pid: int, body: WritingBody, session: SessionDep) -> dict:
    pl = _get(session, pid)
    _save(session, pl, "writing", {"text": body.text.strip()})
    return {"words": len(body.text.split())}


@router.post("/{pid}/finish")
def finish(pid: int, session: SessionDep) -> dict:
    pl = _get(session, pid)
    if pl.finished_at:
        return pl.result or {}
    if pl.material.get("status") != "ready":
        raise HTTPException(400, "문제가 아직 준비되지 않았어요.")
    return placement.finish(session, pl)
