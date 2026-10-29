"""Background loop: push reminders (morning plan, per-routine nudges, evening review) and daily backups.

Runs in a thread inside the server. A reminder goes out once, within a few minutes of its time;
if the PC was asleep at that moment it is skipped rather than sent late.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
from datetime import datetime, timedelta

from sqlmodel import Session, delete

from app.config import BACKUP_DIR, DB_PATH
from app.core import push, store
from app.db import engine
from app.models import Sent
from app.routine.book import Book, logical_today

log = logging.getLogger("routinelab.scheduler")

TICK_S = 20
WINDOW_MIN = 3  # send if we're within this many minutes after the reminder time
KEEP_BACKUPS = 14

_stop = threading.Event()


def start() -> None:
    _stop.clear()
    threading.Thread(target=_loop, name="routinelab-scheduler", daemon=True).start()


def stop() -> None:
    _stop.set()


def _loop() -> None:
    while not _stop.wait(TICK_S):
        try:
            tick(datetime.now())
        except Exception as e:  # never let one bad tick end the loop
            log.exception("scheduler tick failed: %s", e)


def _due(hhmm: str | None, now: datetime) -> bool:
    if not hhmm:
        return False
    h, m = (int(x) for x in hhmm.split(":"))
    at = now.replace(hour=h, minute=m, second=0, microsecond=0)
    return at <= now < at + timedelta(minutes=WINDOW_MIN)


def _once(session: Session, key: str) -> bool:
    """True the first time a key is seen (and records it)."""
    if session.get(Sent, key):
        return False
    session.add(Sent(key=key))
    session.commit()
    return True


def tick(now: datetime) -> list[dict]:
    """One pass. Returns what was sent (for tests)."""
    out: list[dict] = []
    with Session(engine) as session:
        settings = store.settings(session)
        today = logical_today(settings["day_start_hour"], now)
        backup(today)
        book = Book(session, today - timedelta(days=7), today)
        r = book.day(today)
        if r.rest:
            return out
        weekend = now.weekday() >= 5
        quiet = settings["weekend_quiet"] and weekend
        open_items = [i for i in r.items if not i.done and not i.skipped]

        if settings["morning_on"] and not quiet and _due(settings["morning_time"], now) and _once(session, f"morning:{today}"):
            mode = f"{r.mode.emoji} {r.mode.name} 모드 · " if r.mode and not r.mode.is_default else ""
            body = f"{mode}오늘 루틴 {len(r.items)}개" + (f" — 첫 번째: {r.items[0].habit.emoji} {r.items[0].habit.name}" if r.items else "")
            out.append({"title": "좋은 아침이에요 ☀️", "body": body, "tag": "morning", "url": "/"})

        for it in open_items:
            h = it.habit
            if _due(h.reminder, now) and _once(session, f"habit:{h.id}:{today}"):
                actions = [{"action": "done", "title": "했어요"}]
                if h.easy_name:
                    actions.append({"action": "easy", "title": f"가볍게: {h.easy_name}"[:30]})
                cue = f"{h.cue} · " if h.cue else ""
                out.append({"title": f"{h.emoji} {h.name}", "body": f"{cue}아직 안 했어요. 지금 해 볼까요?",
                            "tag": f"habit-{h.id}", "url": "/", "habit_id": h.id, "actions": actions})

        if settings["review_on"] and not quiet and _due(settings["review_time"], now) and _once(session, f"review:{today}"):
            light = {"green": "초록불 🟢", "yellow": "노란불 🟡", "red": "빨간불 🔴"}.get(r.color, "")
            status = f"오늘 {r.done}/{r.total} {light}".strip() if r.total else "오늘 하루"
            out.append({"title": "하루 돌아보기 🌙", "body": f"{status} — 회고 한 줄 남겨요.", "tag": "review", "url": "/journal"})

        for msg in out:
            push.send_all(session, msg)
        if now.minute == 0 and now.second < TICK_S:
            session.exec(delete(Sent).where(Sent.at < now - timedelta(days=30)))
            session.commit()
    return out


def backup(today) -> None:
    """One copy of the database per day in data/backups (keeps the last two weeks)."""
    target = BACKUP_DIR / f"routinelab-{today.isoformat()}.db"
    if target.exists() or not DB_PATH.exists():
        return
    src = sqlite3.connect(DB_PATH)
    try:
        dst = sqlite3.connect(target)
        with dst:
            src.backup(dst)
        dst.close()
    finally:
        src.close()
    for old in sorted(BACKUP_DIR.glob("routinelab-*.db"))[:-KEEP_BACKUPS]:
        old.unlink(missing_ok=True)
