"""Books the learner studies alongside the app (e.g. a TOEFL reading prep book).

Adding a book starts a background research call with web search: which edition it is, whether it matches
the current test format, its level and table of contents, and a schedule (weeks, days per week, minutes
per session) that fits the learner's level, daily study time and target date. Accepting the suggestion
puts the book in the plan: it gets its own block on 오늘, and sessions logged from it count as study
time (and, with a score, as evidence for the skill estimate).
"""

from __future__ import annotations

import logging
import math
import threading
from datetime import date, datetime, timedelta

from sqlmodel import Session, select

from app.core import llm, store
from app.core.llm import BOOL, INT, NUM, STR, arr, obj
from app.db import engine
from app.learn import levels, progress
from app.learn.forecast import BOOK_KIND
from app.models import Book, BookSession, StudyPlan

log = logging.getLogger("englishlab.books")

KINDS = ["test_prep", "textbook", "grammar", "vocabulary", "reader", "novel", "other"]
SKILLS = list(BOOK_KIND)
FITS = ["too_easy", "slightly_easy", "just_right", "challenging", "too_hard"]


def enum(values: list[str]) -> dict:
    return {"type": "string", "enum": values}


RESEARCH_SCHEMA = obj({
    "identified": BOOL,
    "title": STR, "author": STR, "publisher": STR, "edition": STR, "year": STR,
    "kind": enum(KINDS),
    "skill": enum(SKILLS),
    "exam": STR,
    "format_note_ko": STR,
    "level_min": NUM, "level_max": NUM,
    "summary_ko": STR,
    "fit": enum(FITS),
    "fit_reason_ko": STR,
    "unit_label": STR,
    "units": arr(obj({"title": STR, "minutes": INT})),
    "structure_confidence": enum(["toc", "partial", "estimated"]),
    "recommended": obj({"weeks": INT, "days_per_week": INT, "minutes_per_session": INT, "units_per_week": NUM,
                        "start_ko": STR, "intensity_ko": STR}),
    "method_ko": arr(STR),
    "plan_fit_ko": STR,
    "cautions_ko": arr(STR),
    "sources": arr(STR),
})

TOEFL_FORMAT = (
    "Current TOEFL iBT format (since 21 January 2026): each section scored 1-6 in half bands (6 = C2). "
    "Reading: Complete the Words, Read in Daily Life, Read an Academic Passage (adaptive). Listening: Listen and "
    "Choose a Response, Conversation, Announcement, Academic Talk (adaptive). Writing: Build a Sentence, Write an "
    "Email, Academic Discussion. Speaking: Listen and Repeat, Take an Interview. Books written for the old "
    "format (0-120 scores, long reading passages with 10 questions, Integrated Writing, Independent Speaking) "
    "are still useful for skill building but do not practise the new task types."
)


def _learner_facts(session: Session) -> dict:
    cur = levels.current(session)
    p = store.profile(session)
    plan = session.exec(select(StudyPlan).where(StudyPlan.active == True)).first()  # noqa: E712
    others = session.exec(select(Book).where(Book.status.in_(["active", "ready"]))).all()  # type: ignore[attr-defined]
    return {
        "levels_1_to_6": {k: v for k, v in cur["levels"].items() if v is not None},
        "labels": cur["labels"],
        "goal": p["goal"], "target_date": p["target_date"], "today": date.today().isoformat(),
        "daily_study_minutes": p["daily_minutes"],
        "plan_summary": (plan.data or {}).get("summary_ko") if plan else None,
        "other_books": [{"title": b.title, "skill": b.skill, "status": b.status} for b in others],
    }


def _research_prompt(session: Session, book: Book) -> str:
    return llm.as_json_block(
        "Research this book for a Korean adult learner of English, using web search (publisher pages, Korean "
        "bookstores such as Kyobo, Aladin and Yes24, reviews, the table of contents).\n"
        f"Book: “{book.title}”" + (f" by {book.author}" if book.author else "")
        + (f"\nLearner's note about it: {book.notes}" if book.notes else "")
        + f"\n\n{TOEFL_FORMAT}\n\n"
        "Then fill the fields:\n"
        "- identified: whether you found this exact book. title/author/publisher/edition/year of the edition the "
        "learner most likely has (the latest, unless the note says otherwise).\n"
        "- kind, skill: what it mainly trains (skill = the one section/skill it targets; 'mixed' for all-round).\n"
        "- exam: the exam and format it targets (e.g. 'TOEFL iBT, 2026 format'), empty if none. format_note_ko: "
        "for exam books, whether it matches the current format and what is missing; otherwise empty.\n"
        "- level_min/level_max: CEFR range of the material on a 1-6 scale (B1=3, B2=4, C1=5, C2=6).\n"
        "- summary_ko: 2-3 sentences on what the book is and how it is organised.\n"
        "- fit, fit_reason_ko: how well it suits this learner now, and why.\n"
        "- unit_label (e.g. 'Chapter', 'Day', 'Test') and units: the real table of contents if you found it "
        "(up to 60 entries; group smaller sections), each with the minutes THIS learner needs including review. "
        "If you cannot find it, give a realistic estimated structure and set structure_confidence to 'estimated'.\n"
        "- recommended: a schedule for this learner given the daily study minutes (the book shares them with the "
        "rest of the plan), the target date and the other books: weeks, days_per_week, minutes_per_session, "
        "units_per_week; start_ko (when to start, e.g. now or after reaching B2 reading) and intensity_ko.\n"
        "- method_ko: 4-6 concrete steps for studying it well, including how to use the app alongside it (save "
        "unknown words as flashcards, shadow or read aloud with the app's TTS, log each session with its score).\n"
        "- plan_fit_ko: where it fits in the learner's plan and what it replaces or complements.\n"
        "- cautions_ko: honest warnings (old format, answer keys with errors, too hard yet, …).\n"
        "- sources: URLs you actually used.\n"
        "Korean for *_ko fields. Learner:", _learner_facts(session))


def research(session: Session, book: Book) -> Book:
    data = llm.call_json(session, "book", RESEARCH_SCHEMA, max_tokens=16000, web=True,
                         messages=[{"role": "user", "content": _research_prompt(session, book)}])
    units = [u for u in data.get("units") or [] if (u.get("title") or "").strip()][:80]
    rec = data.get("recommended") or {}
    book.info = data
    book.skill = data.get("skill") if data.get("skill") in SKILLS else book.skill
    book.unit_label = (data.get("unit_label") or "Unit").strip()[:20]
    book.units = [{"title": u["title"].strip()[:120], "minutes": max(5, min(240, int(u.get("minutes") or 45)))}
                  for u in units]
    book.days_per_week = max(1, min(7, int(rec.get("days_per_week") or 5)))
    book.minutes_per_session = max(10, min(240, int(rec.get("minutes_per_session") or 45)))
    if not book.author and data.get("author"):
        book.author = data["author"][:120]
    book.status = "ready"
    book.error = None
    session.add(book)
    session.commit()
    return book


_running: set[int] = set()
_lock = threading.Lock()


def research_async(book_id: int) -> None:
    with _lock:
        if book_id in _running:
            return
        _running.add(book_id)

    def run():
        try:
            with Session(engine) as session:
                book = session.get(Book, book_id)
                if not book:
                    return
                try:
                    research(session, book)
                except Exception as e:  # shown on the book page with a retry button
                    log.warning("book research failed: %s", e)
                    book = session.get(Book, book_id)
                    if book:
                        book.status = "error"
                        book.error = str(e)[:400]
                        session.add(book)
                        session.commit()
        finally:
            with _lock:
                _running.discard(book_id)

    threading.Thread(target=run, daemon=True, name=f"book-{book_id}").start()


def create(session: Session, title: str, author: str | None, notes: str | None) -> Book:
    book = Book(created_at=datetime.now(), title=title.strip()[:200], author=(author or "").strip() or None,
                notes=(notes or "").strip() or None)
    session.add(book)
    session.commit()
    session.refresh(book)
    research_async(book.id)
    return book


def retry(session: Session, book: Book) -> Book:
    book.status = "researching"
    book.error = None
    session.add(book)
    session.commit()
    research_async(book.id)
    return book


# ---------- schedule & progress ----------

def units_per_week(book: Book) -> float:
    """Units per week implied by the schedule (sessions × minutes ÷ average unit length)."""
    if not book.units:
        return 0.0
    avg = sum(u["minutes"] for u in book.units) / len(book.units)
    return round(book.days_per_week * book.minutes_per_session / max(avg, 1), 2)


def weekly_minutes(book: Book) -> float:
    return float(book.days_per_week * book.minutes_per_session)


def activate(session: Session, book: Book, *, start: date | None = None, days_per_week: int | None = None,
             minutes_per_session: int | None = None) -> Book:
    """Put the book in the plan with its schedule; the end date follows from the remaining units."""
    if days_per_week:
        book.days_per_week = max(1, min(7, days_per_week))
    if minutes_per_session:
        book.minutes_per_session = max(10, min(240, minutes_per_session))
    book.start_date = start or book.start_date or date.today()
    remaining = sum(u["minutes"] for i, u in enumerate(book.units) if i not in set(book.units_done))
    weeks = remaining / max(weekly_minutes(book), 1)
    book.end_date = book.start_date + timedelta(days=max(7, math.ceil(weeks * 7)))
    book.status = "active"
    session.add(book)
    session.commit()
    return book


def expected_done(book: Book, day: date | None = None) -> float:
    """Units that should be done by `day` on a straight line from start to end."""
    day = day or date.today()
    if not book.start_date or not book.end_date or not book.units:
        return 0.0
    total = (book.end_date - book.start_date).days or 1
    frac = max(0.0, min(1.0, ((day - book.start_date).days + 1) / total))
    return round(frac * len(book.units), 1)


def next_unit(book: Book) -> int | None:
    done = set(book.units_done or [])
    return next((i for i in range(len(book.units)) if i not in done), None)


def status_view(book: Book) -> dict:
    done = len(set(book.units_done or []))
    exp = expected_done(book)
    behind = round(exp - done, 1) if book.status == "active" else 0.0
    upw = units_per_week(book)
    return {
        "done": done, "total": len(book.units), "expected": exp,
        "behind_units": behind,
        "behind_days": round(behind / upw * 7) if upw and behind > 0 else 0,
        "state": ("done" if book.units and done >= len(book.units) else
                  "behind" if behind >= max(1.0, upw * 0.5) else "ahead" if behind <= -1 else "on_track"),
        "next_unit": next_unit(book),
        "units_per_week": upw,
        "weekly_minutes": weekly_minutes(book),
    }


def log_session(session: Session, book: Book, *, minutes: float, units: list[int], score: float | None,
                band: float | None, note: str | None) -> BookSession:
    units = sorted({i for i in units if 0 <= i < len(book.units)})
    row = BookSession(book_id=book.id, created_at=datetime.now(), day=date.today(), minutes=round(minutes, 1),
                      units=units, score=score, band=band, note=(note or "").strip()[:300] or None)
    session.add(row)
    book.units_done = sorted(set(book.units_done or []) | set(units))
    if book.status == "ready":
        activate(session, book)
    if book.units and len(book.units_done) >= len(book.units):
        book.status = "done"
    session.add(book)
    if minutes > 0:
        progress.log_activity(session, BOOK_KIND.get(book.skill, "drill"), minutes, note=f"{book.title[:60]}",
                              commit=False, book_id=book.id)
    # Scores are evidence for the skill estimate: a full mock test on the band scale directly, a share of
    # correct answers relative to the book's level (a perfect score ≈ a little above the material's middle).
    skill = book.skill if book.skill in levels.CORE else None
    if skill and band is not None:
        levels.record(session, skill, band, "mock", note=book.title[:80], commit=False)
    elif skill and score is not None:
        info = book.info or {}
        lo, hi = float(info.get("level_min") or 3.5), float(info.get("level_max") or 4.5)
        mid = (lo + hi) / 2
        levels.record(session, skill, mid - 0.7 + 0.9 * max(0.0, min(1.0, score)), "book", note=book.title[:80],
                      commit=False)
    session.commit()
    session.refresh(row)
    return row


def view(session: Session, book: Book, full: bool = False) -> dict:
    out = {
        "id": book.id, "title": book.title, "author": book.author, "notes": book.notes, "status": book.status,
        "error": book.error, "skill": book.skill, "unit_label": book.unit_label,
        "created_at": book.created_at.isoformat(timespec="minutes"),
        "start_date": book.start_date.isoformat() if book.start_date else None,
        "end_date": book.end_date.isoformat() if book.end_date else None,
        "days_per_week": book.days_per_week, "minutes_per_session": book.minutes_per_session,
        "fit": (book.info or {}).get("fit"), "summary_ko": (book.info or {}).get("summary_ko"),
        "level_min": (book.info or {}).get("level_min"), "level_max": (book.info or {}).get("level_max"),
        "progress": status_view(book),
    }
    if full:
        sessions = session.exec(select(BookSession).where(BookSession.book_id == book.id)
                                .order_by(BookSession.id.desc())).all()
        out |= {
            "info": book.info, "units": book.units, "units_done": book.units_done,
            "sessions": [{"id": s.id, "day": s.day.isoformat(), "minutes": s.minutes, "units": s.units,
                          "score": s.score, "band": s.band, "note": s.note} for s in sessions],
        }
    return out


def active_books(session: Session) -> list[Book]:
    return list(session.exec(select(Book).where(Book.status == "active").order_by(Book.id)).all())
