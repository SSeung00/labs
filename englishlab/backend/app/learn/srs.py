"""Spaced repetition with FSRS: card creation, the daily queue (with caps), and grading."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import fsrs
from sqlmodel import Session, func, select

from app.core import store
from app.learn import lexicon
from app.models import Card, ReviewLog

RETENTION_KEY = "srs_retention"
DEFAULT_RETENTION = 0.9


def _scheduler(session: Session) -> fsrs.Scheduler:
    retention = float(store.get(session, RETENTION_KEY, DEFAULT_RETENTION) or DEFAULT_RETENTION)
    return fsrs.Scheduler(desired_retention=retention, maximum_interval=3650)


def _naive_local(dt: datetime) -> datetime:
    return dt.astimezone().replace(tzinfo=None)


def find_duplicate(session: Session, term: str, kind: str) -> Card | None:
    return session.exec(select(Card).where(func.lower(Card.term) == term.lower().strip(), Card.kind == kind)).first()


def create(session: Session, *, term: str, kind: str = "word", context: str | None = None,
           prompt: str | None = None, meaning_ko: str | None = None, definition_en: str | None = None,
           note: str | None = None, examples: list | None = None, source_kind: str | None = None,
           source_id: int | None = None, commit: bool = True) -> Card:
    """New card due now. Re-adding the same term returns the existing card (context added if missing)."""
    term = term.strip()
    existing = find_duplicate(session, term, kind)
    if existing:
        if context and not existing.context:
            existing.context = context
        if existing.suspended:
            existing.suspended = False
        session.add(existing)
        if commit:
            session.commit()
        return existing
    state = fsrs.Card()
    card = Card(
        created_at=datetime.now(), kind=kind, term=term,
        lemma=lexicon.lemmatize(term) if kind == "word" and " " not in term else None,
        context=context, prompt=prompt, meaning_ko=meaning_ko, definition_en=definition_en, note=note,
        examples=examples or [], source_kind=source_kind, source_id=source_id,
        enriched=bool(meaning_ko and (definition_en or kind == "correction")),
        fsrs=state.to_dict(), due=_naive_local(state.due),
    )
    session.add(card)
    if card.lemma:
        lexicon.mark(session, [card.lemma], "unknown")  # commits
    if commit:
        session.commit()
        session.refresh(card)
    return card


def _day_bounds() -> tuple[datetime, datetime]:
    start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=1)


def counts(session: Session) -> dict:
    now = datetime.now()
    start, _ = _day_bounds()
    total = session.exec(select(func.count()).select_from(Card).where(Card.suspended == False)).one()  # noqa: E712
    due = session.exec(select(func.count()).select_from(Card).where(
        Card.suspended == False, Card.reps > 0, Card.due <= now)).one()  # noqa: E712
    new = session.exec(select(func.count()).select_from(Card).where(
        Card.suspended == False, Card.reps == 0)).one()  # noqa: E712
    reviewed_today = session.exec(select(func.count()).select_from(ReviewLog).where(
        ReviewLog.reviewed_at >= start)).one()
    return {"total": total, "due": due, "new": new, "reviewed_today": reviewed_today,
            "new_today": _new_introduced_today(session)}


def _new_introduced_today(session: Session) -> int:
    """Cards whose first ever review happened today."""
    start, _ = _day_bounds()
    first = select(ReviewLog.card_id, func.min(ReviewLog.reviewed_at).label("first")).group_by(ReviewLog.card_id).subquery()
    return session.exec(select(func.count()).select_from(first).where(first.c.first >= start)).one()


def queue(session: Session, limit: int = 30) -> dict:
    """Next cards to study: due reviews first (most overdue first), then new cards within today's cap."""
    from app.core.store import profile

    p = profile(session)
    now = datetime.now()
    start, _ = _day_bounds()
    reviewed_today = session.exec(select(func.count()).select_from(ReviewLog).where(ReviewLog.reviewed_at >= start)).one()
    review_room = max(0, int(p["max_reviews_per_day"]) - reviewed_today)
    due = session.exec(
        select(Card).where(Card.suspended == False, Card.reps > 0, Card.due <= now)  # noqa: E712
        .order_by(Card.due).limit(min(limit, review_room) if review_room else 0)
    ).all() if review_room else []
    new_room = max(0, int(p["new_cards_per_day"]) - _new_introduced_today(session))
    learning_new = session.exec(  # new cards already seen today but still in learning steps
        select(Card).where(Card.suspended == False, Card.reps == 0)  # noqa: E712
        .order_by(Card.created_at).limit(min(new_room, max(0, limit - len(due))))
    ).all() if new_room else []
    cards = list(due) + list(learning_new)
    if not cards:
        # Cards in (re)learning steps come back within minutes: show them early rather than ending the session.
        soon = now + timedelta(minutes=20)
        cards = list(session.exec(
            select(Card).where(Card.suspended == False, Card.reps > 0, Card.due <= soon)  # noqa: E712
            .order_by(Card.due).limit(limit)
        ).all())
    due_total = session.exec(select(func.count()).select_from(Card).where(
        Card.suspended == False, Card.reps > 0, Card.due <= now)).one()  # noqa: E712
    return {
        "cards": [card_view(c) for c in cards],
        "due_total": due_total,
        "new_left_today": new_room,
        "review_cap_left": review_room,
    }


def card_view(c: Card) -> dict:
    return {
        "id": c.id, "kind": c.kind, "term": c.term, "lemma": c.lemma, "context": c.context, "prompt": c.prompt,
        "meaning_ko": c.meaning_ko, "definition_en": c.definition_en, "ipa": c.ipa, "examples": c.examples,
        "note": c.note, "enriched": c.enriched, "reps": c.reps, "lapses": c.lapses,
        "due": c.due.isoformat(timespec="minutes"), "state": (c.fsrs or {}).get("state"),
        "stability": (c.fsrs or {}).get("stability"), "suspended": c.suspended,
        "created_at": c.created_at.isoformat(timespec="minutes"), "source_kind": c.source_kind,
    }


def grade(session: Session, card: Card, rating: int, duration_ms: int | None = None) -> dict:
    if rating not in (1, 2, 3, 4):
        raise ValueError("rating must be 1-4")
    sched = _scheduler(session)
    state = fsrs.Card.from_dict(card.fsrs) if card.fsrs else fsrs.Card()
    now = datetime.now(UTC)
    new_state, _log = sched.review_card(state, fsrs.Rating(rating), review_datetime=now)
    card.fsrs = new_state.to_dict()
    card.due = _naive_local(new_state.due)
    card.reps += 1
    if rating == 1 and (state.state != fsrs.State.Learning):
        card.lapses += 1
    session.add(card)
    session.add(ReviewLog(card_id=card.id, reviewed_at=datetime.now(), rating=rating, duration_ms=duration_ms))
    # A word card reviewed successfully a few times with a long interval → the word is known.
    if card.lemma and rating >= 3 and (new_state.stability or 0) >= 21:
        lexicon.mark(session, [card.lemma], "known")
    session.commit()
    return {"due": card.due.isoformat(timespec="minutes"),
            "interval_days": round(max(0.0, (card.due - datetime.now()).total_seconds() / 86400), 2)}


def preview_intervals(session: Session, card: Card) -> dict[int, float]:
    """Days until next review for each rating (shown on the buttons)."""
    sched = _scheduler(session)
    state = fsrs.Card.from_dict(card.fsrs) if card.fsrs else fsrs.Card()
    now = datetime.now(UTC)
    out = {}
    for r in (1, 2, 3, 4):
        s, _ = sched.review_card(fsrs.Card.from_dict(state.to_dict()), fsrs.Rating(r), review_datetime=now)
        out[r] = round((s.due - now).total_seconds() / 86400, 3)
    return out


def retention_stats(session: Session, days: int = 30) -> dict:
    since = datetime.now() - timedelta(days=days)
    rows = session.exec(select(ReviewLog.rating).where(ReviewLog.reviewed_at >= since)).all()
    if not rows:
        return {"reviews": 0, "retention": None}
    return {"reviews": len(rows), "retention": round(sum(1 for r in rows if r >= 2) / len(rows), 3)}
