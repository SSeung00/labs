"""Word knowledge: a frequency-ranked lemma list, known-word estimates and text coverage.

A word counts as known if the learner marked it known, or if it is not marked unknown and its
frequency rank is within the estimated vocabulary size. That estimate comes from the placement
yes/no test and grows as the learner marks words known while reading.
"""

from __future__ import annotations

import re
from datetime import datetime
from functools import lru_cache

import simplemma
from sqlmodel import Session, select

from app.core import store
from app.models import KnownWord

VOCAB_KEY = "vocab_estimate"  # lemmas, from the placement test
DEFAULT_VOCAB = 4000

WORD_RE = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)*")

# Words that are not vocabulary (names of months, numbers written out are fine to count).
_STOP_TOKENS = {"s", "t", "d", "ll", "re", "ve", "m"}


@lru_cache(maxsize=1)
def lemma_ranks() -> dict[str, int]:
    """lemma → frequency rank (1 = most common), built from wordfreq's top word forms."""
    from wordfreq import top_n_list

    ranks: dict[str, int] = {}
    for form in top_n_list("en", 80000):
        if not form.isalpha() or len(form) == 1 and form not in ("a", "i"):
            continue
        lemma = lemmatize(form)
        if lemma not in ranks:
            ranks[lemma] = len(ranks) + 1
    return ranks


@lru_cache(maxsize=50000)
def lemmatize(word: str) -> str:
    w = word.lower().replace("’", "'")
    if "'" in w:
        w = w.split("'")[0]
    return simplemma.lemmatize(w, lang="en").lower()


def rank_of(lemma: str) -> int | None:
    return lemma_ranks().get(lemma)


def lemmas_in_band(start: int, end: int) -> list[str]:
    """Lemmas with rank in [start, end)."""
    return [lem for lem, r in lemma_ranks().items() if start <= r < end]


def vocab_estimate(session: Session) -> int:
    try:
        return int(store.get(session, VOCAB_KEY, DEFAULT_VOCAB))
    except (TypeError, ValueError):
        return DEFAULT_VOCAB


def set_vocab_estimate(session: Session, n: int) -> None:
    store.put(session, VOCAB_KEY, max(500, int(n)))


def overrides(session: Session) -> dict[str, str]:
    return {k.lemma: k.status for k in session.exec(select(KnownWord)).all()}


def mark(session: Session, lemmas: list[str], status: str) -> int:
    now = datetime.now()
    n = 0
    for lem in {lemmatize(x) for x in lemmas if x.strip()}:
        row = session.get(KnownWord, lem) or KnownWord(lemma=lem, status=status, updated_at=now)
        row.status = status
        row.updated_at = now
        session.add(row)
        n += 1
    session.commit()
    return n


def is_known(lemma: str, vocab: int, marks: dict[str, str]) -> bool:
    status = marks.get(lemma)
    if status in ("known", "ignore"):
        return True
    if status == "unknown":
        return False
    r = rank_of(lemma)
    # Words missing from the list are rare words or names; names are filtered by the caller.
    return r is not None and r <= vocab


def tokens(text: str) -> list[tuple[str, bool]]:
    """(word, looks_like_name) for each word token. A capitalised word not at sentence start is a name."""
    out: list[tuple[str, bool]] = []
    sentence_start = True
    for m in re.finditer(r"[A-Za-z]+(?:['’][A-Za-z]+)*|[.!?]", text):
        tok = m.group(0)
        if tok in ".!?":
            sentence_start = True
            continue
        name = tok[0].isupper() and not sentence_start and tok.lower() not in ("i",)
        out.append((tok, name))
        sentence_start = False
    return out


def coverage(session: Session, text: str, vocab: int | None = None, marks: dict[str, str] | None = None) -> dict:
    """Share of running words the learner likely knows, plus the likely-unknown lemmas (by frequency)."""
    vocab = vocab if vocab is not None else vocab_estimate(session)
    marks = marks if marks is not None else overrides(session)
    total = known = 0
    unknown: dict[str, int] = {}
    forms: dict[str, str] = {}  # surface form (lowercase) → lemma, for likely-unknown words only
    for tok, name in tokens(text):
        lem = lemmatize(tok)
        if name or lem in _STOP_TOKENS:
            continue
        total += 1
        if is_known(lem, vocab, marks):
            known += 1
        else:
            unknown[lem] = unknown.get(lem, 0) + 1
            forms[tok.lower().replace("’", "'")] = lem
    ordered = sorted(unknown, key=lambda lem: rank_of(lem) or 10**9)
    return {
        "tokens": total,
        "coverage": round(known / total, 4) if total else 1.0,
        "unknown": ordered,
        "forms": forms,
    }


def known_count(session: Session) -> int:
    """Estimated number of lemmas known: frequency estimate adjusted by explicit marks."""
    vocab = vocab_estimate(session)
    marks = overrides(session)
    extra = sum(1 for lem, s in marks.items() if s == "known" and (rank_of(lem) or 10**9) > vocab)
    minus = sum(1 for lem, s in marks.items() if s == "unknown" and (rank_of(lem) or 10**9) <= vocab)
    return max(0, vocab + extra - minus)


# ---------- CEFR helpers (1.0–6.0 scale) ----------

CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"]


def cefr_label(level: float | None) -> str:
    if level is None:
        return "-"
    level = max(1.0, min(6.0, float(level)))
    base = CEFR[min(5, int(level) - 1)]
    frac = level - int(level)
    if int(level) == 6:
        return "C2"
    return base + ("+" if frac >= 0.5 else "")


# Rough lemma counts by level (receptive). C2 aims at ~98% coverage of unscripted native TV.
VOCAB_BY_LEVEL = [(1.0, 0), (2.0, 1500), (3.0, 2750), (4.0, 4250), (5.0, 6500), (6.0, 9500)]


def level_from_vocab(n: int) -> float:
    pts = VOCAB_BY_LEVEL
    if n <= pts[0][1]:
        return pts[0][0]
    for (l1, v1), (l2, v2) in zip(pts, pts[1:], strict=False):
        if n <= v2:
            return round(l1 + (n - v1) / (v2 - v1) * (l2 - l1), 2)
    return 6.0


def vocab_for_level(level: float) -> int:
    pts = VOCAB_BY_LEVEL
    for (l1, v1), (l2, v2) in zip(pts, pts[1:], strict=False):
        if level <= l2:
            return int(v1 + (level - l1) / (l2 - l1) * (v2 - v1))
    return pts[-1][1]
