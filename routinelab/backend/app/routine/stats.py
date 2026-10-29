"""Stats: the traffic-light calendar, weekly rates, per-routine heatmaps and streaks, body/mood trends, badges."""

from __future__ import annotations

from datetime import date, timedelta

from sqlmodel import Session, select

from app.core import store
from app.models import DayLog, Habit
from app.routine.book import Book, daterange, logical_today, week_start
from app.routine.service import habit_out, signal_out

CALENDAR_DAYS = 371  # 53 weeks, enough for a year view
HEAT_WEEKS = 18
MAX_HISTORY_DAYS = 730


def _heat_code(book: Book, h: Habit, d: date) -> str:
    if d > book.today:
        return "future"
    r = book.day(d)
    it = r.by_habit.get(h.id)
    if it is None:
        return "none"
    if r.rest:
        return "rest"
    if it.done:
        return it.entry.state if it.entry else "done"  # done | easy
    if it.skipped:
        return "skip"
    if d == book.today:
        return "todo"
    return "miss" if it.counted else "none"


def stats(session: Session) -> dict:
    settings = store.settings(session)
    today = logical_today(settings["day_start_hour"])
    habits = session.exec(select(Habit)).all()
    first = min((h.start_date for h in habits), default=today)
    start = max(first, today - timedelta(days=MAX_HISTORY_DAYS))
    book = Book(session, start, today)

    cal_start = today - timedelta(days=CALENDAR_DAYS - 1)
    calendar = [signal_out(book.day(d)) for d in daterange(cal_start, today)]

    weeks = []
    ws = week_start(today)
    for i in range(11, -1, -1):
        s = ws - timedelta(weeks=i)
        rs = [book.day(d) for d in daterange(s, min(s + timedelta(days=6), today))]
        done = sum(r.done for r in rs if r.color not in ("off",) or r.day < today)
        total = sum(r.total for r in rs if r.color not in ("off",) or r.day < today)
        weeks.append({"start": s.isoformat(), "done": done, "total": total, "rate": done / total if total else None,
                      "green_days": sum(r.color == "green" for r in rs)})

    heat_start = week_start(today) - timedelta(weeks=HEAT_WEEKS - 1)
    per_habit = []
    for h in book.habits:
        if h.archived:
            continue
        last30 = [book._outcome(h, d) for d in daterange(today - timedelta(days=29), today)]
        done30 = last30.count("done")
        counted30 = done30 + last30.count("miss")
        per_habit.append({
            **habit_out(h),
            "rate30": done30 / counted30 if counted30 else None,
            "done30": done30,
            "streak": book.habit_streak(h, today),
            "best": book.best_habit_streak(h),
            "heat_start": heat_start.isoformat(),
            "heat": [_heat_code(book, h, d) for d in daterange(heat_start, heat_start + timedelta(weeks=HEAT_WEEKS) - timedelta(days=1))],
            "total_done": sum(1 for (hid, _), e in book.entries.items() if hid == h.id and e.state in ("done", "easy")),
        })

    logs = session.exec(select(DayLog).where(DayLog.day >= today - timedelta(days=89)).order_by(DayLog.day)).all()
    body = [{"day": x.day.isoformat(), "mood": x.mood, "energy": x.energy, "sleep_hours": x.sleep_hours,
             "weight": x.weight} for x in logs]

    current = book.day_streak(today)
    best = book.best_day_streak()
    return {
        "today": today.isoformat(),
        "calendar": calendar,
        "weeks": weeks,
        "habits": per_habit,
        "body": body,
        "streak": {"current": current, "best": best},
        "badges": _badges(session, book, calendar, best, per_habit),
    }


def _badges(session: Session, book: Book, calendar: list[dict], best: int, per_habit: list[dict]) -> list[dict]:
    greens = sum(c["color"] == "green" for c in calendar)
    perfect = sum(c["total"] > 0 and c["done"] == c["total"] and c["color"] != "rest" for c in calendar)
    logs = len(session.exec(select(DayLog.day)).all())
    best_habit = max((h["best"] for h in per_habit), default=0)
    total_done = sum(h["total_done"] for h in per_habit)

    def b(key: str, emoji: str, title: str, desc: str, have: float, need: float) -> dict:
        return {"key": key, "emoji": emoji, "title": title, "desc": desc, "earned": have >= need,
                "progress": min(1.0, have / need) if need else 1.0}

    return [
        b("first_green", "🟢", "첫 초록불", "하루 루틴의 기준 이상을 해낸 첫날", greens, 1),
        b("perfect_day", "🌟", "완벽한 하루", "그날 루틴을 전부 해낸 날", perfect, 1),
        b("green_7", "🔥", "7일 연속 초록불", "일주일 내내 초록불", best, 7),
        b("green_30", "🏅", "30일 연속 초록불", "한 달 내내 초록불", best, 30),
        b("habit_21", "🌱", "21일 습관", "한 루틴을 21일 이어가기", best_habit, 21),
        b("habit_66", "🌳", "66일, 몸에 밴 습관", "습관이 자리 잡는다는 66일", best_habit, 66),
        b("checks_100", "💯", "체크 100개", "루틴을 모두 합쳐 100번 해내기", total_done, 100),
        b("journal_7", "📔", "회고 7일", "하루 돌아보기를 7번 남기기", logs, 7),
        b("journal_30", "📚", "회고 30일", "하루 돌아보기를 30번 남기기", logs, 30),
    ]
