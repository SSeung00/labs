"""Flashcards (FSRS), known-word marks, mistakes."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import func, or_, select

from app.db import SessionDep
from app.learn import lexicon, mistakes, progress, srs, words
from app.models import Card, Mistake

router = APIRouter(tags=["words"])


@router.get("/cards/queue")
def queue(session: SessionDep, limit: int = 30) -> dict:
    q = srs.queue(session, limit)
    for c in q["cards"]:
        card = session.get(Card, c["id"])
        c["intervals"] = srs.preview_intervals(session, card)
    return q


@router.get("/cards")
def list_cards(session: SessionDep, q: str = "", kind: str = "", offset: int = 0, limit: int = 100) -> dict:
    stmt = select(Card)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(Card.term).like(like), func.lower(Card.meaning_ko).like(like)))
    if kind:
        stmt = stmt.where(Card.kind == kind)
    words.retry_unenriched(session)
    total = session.exec(select(func.count()).select_from(stmt.subquery())).one()
    rows = session.exec(stmt.order_by(Card.id.desc()).offset(offset).limit(limit)).all()
    return {"total": total, "cards": [srs.card_view(c) for c in rows], "counts": srs.counts(session),
            "retention": srs.retention_stats(session)}


class CardBody(BaseModel):
    term: str = Field(min_length=1, max_length=300)
    kind: str = Field(default="word", pattern="^(word|phrase|correction)$")
    context: str | None = Field(default=None, max_length=1200)
    prompt: str | None = None
    meaning_ko: str | None = None
    definition_en: str | None = None
    note: str | None = None
    source_kind: str | None = None
    source_id: int | None = None


@router.post("/cards")
def add_card(body: CardBody, session: SessionDep) -> dict:
    kind = body.kind
    if kind == "word" and " " in body.term.strip():
        kind = "phrase"
    card = srs.create(session, term=body.term, kind=kind, context=body.context, prompt=body.prompt,
                      meaning_ko=body.meaning_ko, definition_en=body.definition_en, note=body.note,
                      source_kind=body.source_kind, source_id=body.source_id)
    if not card.enriched:
        words.enrich_async(card.id)
    return srs.card_view(card)


def _card(session, cid: int) -> Card:
    c = session.get(Card, cid)
    if not c:
        raise HTTPException(404, "카드를 찾을 수 없어요.")
    return c


@router.get("/cards/{cid}")
def get_card(cid: int, session: SessionDep) -> dict:
    return srs.card_view(_card(session, cid))


class GradeBody(BaseModel):
    rating: int = Field(ge=1, le=4)
    duration_ms: int | None = None


@router.post("/cards/{cid}/grade")
def grade(cid: int, body: GradeBody, session: SessionDep) -> dict:
    return srs.grade(session, _card(session, cid), body.rating, body.duration_ms)


class ReviewDoneBody(BaseModel):
    minutes: float = Field(ge=0, le=240)
    count: int = 0


@router.post("/cards/session")
def review_session(body: ReviewDoneBody, session: SessionDep) -> dict:
    """Log a finished review session's time (keeps the streak and fills the 복습 block)."""
    if body.count > 0 and body.minutes > 0:
        progress.log_activity(session, "review", body.minutes, note=f"{body.count} cards")
    return {"ok": True}


class EditBody(BaseModel):
    term: str | None = None
    meaning_ko: str | None = None
    definition_en: str | None = None
    note: str | None = None
    suspended: bool | None = None


@router.patch("/cards/{cid}")
def edit_card(cid: int, body: EditBody, session: SessionDep) -> dict:
    c = _card(session, cid)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(c, k, v)
    session.add(c)
    session.commit()
    return srs.card_view(c)


@router.post("/cards/{cid}/enrich")
def enrich(cid: int, session: SessionDep) -> dict:
    return srs.card_view(words.enrich(session, _card(session, cid)))


@router.delete("/cards/{cid}")
def delete_card(cid: int, session: SessionDep) -> dict:
    c = _card(session, cid)
    for m in session.exec(select(Mistake).where(Mistake.card_id == cid)).all():
        m.card_id = None
        session.add(m)
    session.delete(c)
    session.commit()
    return {"ok": True}


class MarkBody(BaseModel):
    words: list[str]
    status: str = Field(pattern="^(known|unknown|ignore)$")


@router.post("/known")
def mark(body: MarkBody, session: SessionDep) -> dict:
    n = lexicon.mark(session, body.words, body.status)
    return {"marked": n, "known_count": lexicon.known_count(session)}


@router.get("/mistakes")
def list_mistakes(session: SessionDep) -> list[dict]:
    rows = session.exec(select(Mistake).order_by(Mistake.resolved, Mistake.count.desc(), Mistake.last_seen.desc())).all()
    return [mistakes.view(m) for m in rows]


class MistakeBody(BaseModel):
    resolved: bool


@router.patch("/mistakes/{mid}")
def edit_mistake(mid: int, body: MistakeBody, session: SessionDep) -> dict:
    m = session.get(Mistake, mid)
    if not m:
        raise HTTPException(404)
    m.resolved = body.resolved
    session.add(m)
    session.commit()
    return mistakes.view(m)
