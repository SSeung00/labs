"""Recurring error patterns → merged by pattern label → correction cards (error-to-drill pipeline)."""

from __future__ import annotations

from datetime import datetime

from sqlmodel import Session, func, select

from app.core import store
from app.core.llm import STR, obj
from app.learn import srs
from app.models import Mistake

CATEGORIES = ["grammar", "vocabulary", "naturalness", "pronunciation"]

MISTAKE_ITEM = obj({
    "pattern": STR,  # short English label of the error type, reusable across sessions
    "category": {"type": "string", "enum": CATEGORIES},
    "wrong": STR,
    "right": STR,
    "explanation_ko": STR,
})


def merge(session: Session, items: list[dict], source: str, source_id: int | None = None) -> list[Mistake]:
    """Insert or bump mistakes; create a correction card for each new one if the learner wants that."""
    auto = bool(store.profile(session)["auto_mistake_cards"])
    now = datetime.now()
    out = []
    for it in items:
        pattern = (it.get("pattern") or "").strip()
        if not pattern or not it.get("wrong") or not it.get("right"):
            continue
        row = session.exec(select(Mistake).where(func.lower(Mistake.pattern) == pattern.lower())).first()
        if row:
            row.count += 1
            row.last_seen = now
            row.example_wrong, row.example_right = it["wrong"], it["right"]
            row.explanation_ko = it.get("explanation_ko") or row.explanation_ko
            row.resolved = False
        else:
            row = Mistake(created_at=now, last_seen=now, pattern=pattern, category=it.get("category", "grammar"),
                          example_wrong=it["wrong"], example_right=it["right"],
                          explanation_ko=it.get("explanation_ko", ""))
        session.add(row)
        session.flush()
        if auto and row.card_id is None and it.get("category") != "pronunciation":
            card = srs.create(session, term=it["right"], kind="correction", prompt=it["wrong"],
                              meaning_ko=it.get("explanation_ko"), note=pattern, source_kind=source,
                              source_id=source_id, commit=False)
            session.flush()
            row.card_id = card.id
            session.add(row)
        out.append(row)
    session.commit()
    return out


def view(m: Mistake) -> dict:
    return {"id": m.id, "pattern": m.pattern, "category": m.category, "wrong": m.example_wrong,
            "right": m.example_right, "explanation_ko": m.explanation_ko, "count": m.count,
            "last_seen": m.last_seen.isoformat(timespec="minutes"), "card_id": m.card_id, "resolved": m.resolved}


def top(session: Session, limit: int = 8) -> list[Mistake]:
    return list(session.exec(
        select(Mistake).where(Mistake.resolved == False).order_by(Mistake.count.desc(), Mistake.last_seen.desc()).limit(limit)  # noqa: E712
    ).all())
