"""Reads and writes behind the API: the day's payload, entries, todos and the reflection log."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta

from sqlmodel import Session, select

from app.core import store
from app.models import DayLog, Entry, Habit, Mode, Period, Todo
from app.routine.book import Book, DayResult, HabitDay, logical_today, week_start
from app.routine.templates import DEFAULT_MODES

STREAK_LOOKBACK_DAYS = 400
STATES = ("", "done", "easy", "skip")


def ensure_defaults(session: Session) -> None:
    if session.exec(select(Mode)).first() is None:
        for i, m in enumerate(DEFAULT_MODES):
            session.add(Mode(sort=i, **m))
        session.commit()
    elif session.exec(select(Mode).where(Mode.is_default)).first() is None:
        first = session.exec(select(Mode).order_by(Mode.sort, Mode.id)).first()
        first.is_default = True
        session.add(first)
        session.commit()


# ---------- serialization ----------

def habit_out(h: Habit) -> dict:
    return {
        "id": h.id, "name": h.name, "emoji": h.emoji, "color": h.color, "category": h.category,
        "slot": h.slot, "kind": h.kind, "target": h.target, "unit": h.unit, "schedule": h.schedule,
        "days": [int(x) for x in h.days.split(",") if x.strip().isdigit()], "per_week": h.per_week,
        "easy_name": h.easy_name, "cue": h.cue, "reminder": h.reminder,
        "modes": [int(x) for x in h.modes.split(",") if x.strip().isdigit()], "note": h.note,
        "sort": h.sort, "archived": h.archived, "start_date": h.start_date.isoformat(),
    }


def mode_out(m: Mode | None) -> dict | None:
    return {"id": m.id, "name": m.name, "emoji": m.emoji, "is_default": m.is_default} if m else None


def period_out(p: Period) -> dict:
    return {"id": p.id, "kind": p.kind, "mode_id": p.mode_id, "start": p.start.isoformat(),
            "end": p.end.isoformat(), "note": p.note}


def todo_out(t: Todo) -> dict:
    return {"id": t.id, "title": t.title, "day": t.day.isoformat(), "time": t.time, "done": t.done, "sort": t.sort}


def log_out(log: DayLog | None, d: date) -> dict:
    if log is None:
        return {"day": d.isoformat(), "mood": None, "energy": None, "sleep_hours": None, "weight": None,
                "answers": {}, "note": ""}
    try:
        answers = json.loads(log.answers or "{}")
    except json.JSONDecodeError:
        answers = {}
    return {"day": log.day.isoformat(), "mood": log.mood, "energy": log.energy, "sleep_hours": log.sleep_hours,
            "weight": log.weight, "answers": answers, "note": log.note}


def signal_out(r: DayResult) -> dict:
    return {"day": r.day.isoformat(), "done": r.done, "total": r.total, "rate": r.rate, "color": r.color}


def item_out(it: HabitDay, book: Book, d: date) -> dict:
    e = it.entry
    return {
        **habit_out(it.habit),
        "entry": {"value": e.value, "state": e.state, "note": e.note} if e else None,
        "done": it.done,
        "counted": it.counted,
        "week_done": it.week_done,
        "streak": book.habit_streak(it.habit, d),
    }


# ---------- the day ----------

def day_payload(session: Session, d: date | None = None) -> dict:
    settings = store.settings(session)
    today = logical_today(settings["day_start_hour"])
    d = d or today
    book = Book(session, d - timedelta(days=STREAK_LOOKBACK_DAYS), max(d, today))
    r = book.day(d)
    todos = session.exec(select(Todo).where(Todo.day == d).order_by(Todo.done, Todo.time, Todo.sort, Todo.created_at)).all()
    overdue = session.exec(select(Todo).where(Todo.day < d, Todo.day >= d - timedelta(days=14), Todo.done == False)).all()  # noqa: E712
    week = [signal_out(book.day(week_start(d) + timedelta(days=i))) for i in range(7)]
    return {
        "day": d.isoformat(),
        "today": today.isoformat(),
        "mode": mode_out(r.mode),
        "rest": period_out(r.rest) if r.rest else None,
        "signal": signal_out(r),
        "streak": {"current": book.day_streak(min(d, today))},
        "habits": [item_out(it, book, d) for it in r.items],
        "todos": [todo_out(t) for t in todos],
        "overdue": len(overdue) if d == today else 0,
        "log": log_out(session.get(DayLog, d), d),
        "week": week,
        "questions": settings["questions"],
        "thresholds": {"green": settings["green_at"], "yellow": settings["yellow_at"]},
        "has_habits": session.exec(select(Habit).where(Habit.archived == False)).first() is not None,  # noqa: E712
    }


def set_entry(session: Session, habit_id: int, d: date, *, value: float | None = None, state: str | None = None,
              note: str | None = None) -> None:
    h = session.get(Habit, habit_id)
    if h is None:
        raise ValueError("없는 루틴이에요.")
    if state is not None and state not in STATES:
        raise ValueError("알 수 없는 상태예요.")
    e = session.exec(select(Entry).where(Entry.habit_id == habit_id, Entry.day == d)).first() or Entry(habit_id=habit_id, day=d)
    quantity = h.kind != "check"
    if value is not None:
        e.value = max(0.0, float(value))
        if quantity and state is None:
            if e.value >= h.target:
                e.state = "done"
            elif e.state == "done":
                e.state = ""
    if state is not None:
        e.state = state
        if not quantity:
            e.value = 1.0 if state in ("done", "easy") else 0.0
        elif state == "done" and value is None:
            e.value = max(e.value, h.target)
    if note is not None:
        e.note = note.strip()[:500]
    e.updated_at = datetime.now()
    if not e.state and not e.value and not e.note:
        if e.id is not None:
            session.delete(e)
    else:
        session.add(e)
    session.commit()


def quick_check(session: Session, habit_id: int, action: str) -> None:
    """From a notification button: mark today's routine done (or done the easy way)."""
    d = logical_today(store.settings(session)["day_start_hour"])
    set_entry(session, habit_id, d, state="easy" if action == "easy" else "done")


def upsert_todo(session: Session, todo_id: str, changes: dict) -> Todo:
    t = session.get(Todo, todo_id)
    if t is None:
        title = str(changes.get("title") or "").strip()
        if not title:
            raise ValueError("할 일 내용을 적어 주세요.")
        t = Todo(id=todo_id, title=title, day=changes.get("day") or logical_today(store.settings(session)["day_start_hour"]))
    if "title" in changes and str(changes["title"]).strip():
        t.title = str(changes["title"]).strip()[:200]
    if changes.get("day"):
        t.day = changes["day"]
    if "time" in changes:
        t.time = changes["time"] or None
    if "sort" in changes and changes["sort"] is not None:
        t.sort = int(changes["sort"])
    if "done" in changes and changes["done"] is not None and bool(changes["done"]) != t.done:
        t.done = bool(changes["done"])
        t.done_at = datetime.now() if t.done else None
    session.add(t)
    session.commit()
    return t


def carry_over(session: Session, to_day: date) -> int:
    """Move unfinished todos from the last two weeks onto `to_day`."""
    rows = session.exec(select(Todo).where(Todo.day < to_day, Todo.day >= to_day - timedelta(days=14), Todo.done == False)).all()  # noqa: E712
    for t in rows:
        t.day = to_day
        session.add(t)
    session.commit()
    return len(rows)


def put_log(session: Session, d: date, changes: dict) -> DayLog:
    log = session.get(DayLog, d) or DayLog(day=d)
    for k in ("mood", "energy"):
        if k in changes:
            v = changes[k]
            setattr(log, k, None if v is None else max(1, min(5, int(v))))
    for k, lo, hi in (("sleep_hours", 0, 24), ("weight", 20, 300)):
        if k in changes:
            v = changes[k]
            setattr(log, k, None if v in (None, "") else max(lo, min(hi, float(v))))
    if "answers" in changes and isinstance(changes["answers"], dict):
        clean = {str(q)[:120]: str(a).strip()[:2000] for q, a in changes["answers"].items() if str(a).strip()}
        log.answers = json.dumps(clean, ensure_ascii=False)
    if "note" in changes:
        log.note = str(changes["note"] or "").strip()[:5000]
    log.updated_at = datetime.now()
    session.add(log)
    session.commit()
    return log
