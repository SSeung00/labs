"""Tap-to-translate lookups and AI-filled flashcards (both Haiku, both cached)."""

from __future__ import annotations

import hashlib
import logging
import threading
from datetime import datetime

from sqlmodel import Session, select

from app.core import llm
from app.core.llm import STR, arr, obj
from app.db import engine
from app.learn import lexicon
from app.models import Card, Gloss

log = logging.getLogger("englishlab.words")

GLOSS_SCHEMA = obj({
    "lemma": STR, "pos": STR, "meaning_ko": STR, "definition_en": STR, "ipa": STR,
    "note_ko": STR, "example_en": STR, "example_ko": STR,
})


def gloss(session: Session, term: str, sentence: str) -> dict:
    term = term.strip()[:120]
    sentence = sentence.strip()[:600]
    key = hashlib.sha1(f"{term.lower()}|{sentence}".encode()).hexdigest()
    row = session.exec(select(Gloss).where(Gloss.key == key)).first()
    if row:
        return row.data
    prompt = (
        f"A Korean learner of English tapped “{term}” in this sentence:\n{sentence}\n\n"
        "Explain it for this exact context. lemma: dictionary form (for a phrase, the phrase). pos: part of speech "
        "(or 'phrase'/'idiom'). meaning_ko: short Korean meaning that fits this sentence. definition_en: a simple "
        "English definition (learner dictionary style). ipa: American IPA of the lemma (empty for long phrases). "
        "note_ko: one short Korean note on usage, collocation, nuance or register (empty if nothing useful). "
        "example_en/example_ko: one new natural example sentence and its Korean translation."
    )
    data = llm.call_json(session, "gloss", GLOSS_SCHEMA, max_tokens=2000, messages=[{"role": "user", "content": prompt}])
    data["rank"] = lexicon.rank_of(lexicon.lemmatize(data.get("lemma") or term)) if " " not in term else None
    session.add(Gloss(key=key, term=term, data=data, created_at=datetime.now()))
    session.commit()
    return data


CARD_SCHEMA = obj({
    "meaning_ko": STR, "definition_en": STR, "ipa": STR,
    "examples": arr(obj({"en": STR, "ko": STR})),
    "note": STR,
})


def enrich(session: Session, card: Card) -> Card:
    if card.kind == "correction":
        card.enriched = True
        session.add(card)
        session.commit()
        return card
    prompt = (
        f"Make a flashcard back for a Korean learner of English (B2→C2). Item: “{card.term}” ({card.kind})."
        + (f"\nIt was met in: {card.context}" if card.context else "")
        + "\nmeaning_ko: concise Korean meaning (the sense used in the context first). definition_en: simple English "
        "definition. ipa: American IPA (empty for long phrases). examples: 2 natural, everyday or academic example "
        "sentences using it, with Korean translations. note: key collocations and register/nuance in a short mix of "
        "English and Korean (e.g. 'make a decision / reach a decision — 격식체에서는 reach')."
    )
    data = llm.call_json(session, "card", CARD_SCHEMA, max_tokens=2000, messages=[{"role": "user", "content": prompt}])
    card.meaning_ko = card.meaning_ko or data["meaning_ko"]
    card.definition_en = data["definition_en"]
    card.ipa = data["ipa"] or None
    card.examples = data["examples"]
    card.note = data["note"] or None
    card.enriched = True
    session.add(card)
    session.commit()
    return card


_enriching: set[int] = set()
_enriching_lock = threading.Lock()


def enrich_async(card_id: int) -> None:
    with _enriching_lock:
        if card_id in _enriching:
            return
        _enriching.add(card_id)

    def run():
        try:
            with Session(engine) as session:
                card = session.get(Card, card_id)
                if card and not card.enriched:
                    try:
                        enrich(session, card)
                    except Exception as e:
                        log.warning("card enrich failed: %s", e)
        finally:
            with _enriching_lock:
                _enriching.discard(card_id)

    threading.Thread(target=run, daemon=True, name=f"enrich-{card_id}").start()


def retry_unenriched(session: Session, limit: int = 5) -> None:
    """Cards whose AI fill failed earlier (e.g. AI unavailable) get another try when the word list is opened."""
    rows = session.exec(select(Card.id).where(Card.enriched == False, Card.kind != "correction")  # noqa: E712
                        .order_by(Card.id).limit(limit)).all()
    for cid in rows:
        enrich_async(cid)
