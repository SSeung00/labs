"""How each day went: which routines were listed, which got done, and the day's traffic light.

A Book loads habits, entries, modes and periods for a date range once and evaluates days from
memory (cached per day), so streaks and a year of stats stay cheap.

Rules, in the spirit of "missing a day shouldn't make you feel guilty":
- The light turns green at `green_at` (default 60%) of the day's counted routines.
- A skipped routine ("오늘은 쉬어요") leaves the count; the easy version counts as done.
- A break period (휴가) pauses everything: no light, no streak damage.
- Weekly routines (N times a week) only count on days you do them, or on the last day the
  weekly goal can still be met — never when the goal is already out of reach.
- Habit streaks forgive a single missed day; two misses in a row end them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlmodel import Session, select

from app.core import store
from app.models import Entry, Habit, Mode, Period

SLOTS = ("morning", "day", "evening", "night", "anytime")
DONE_STATES = ("done", "easy")


def logical_today(day_start_hour: int, now: datetime | None = None) -> date:
    now = now or datetime.now()
    return (now - timedelta(hours=day_start_hour)).date()


def today(session: Session) -> date:
    return logical_today(store.settings(session)["day_start_hour"])


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def daterange(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def mode_ids(h: Habit) -> set[int]:
    return {int(x) for x in h.modes.split(",") if x.strip().isdigit()}


def weekdays(h: Habit) -> set[int]:
    return {int(x) for x in h.days.split(",") if x.strip().isdigit() and 0 <= int(x) <= 6}


def exists_on(h: Habit, d: date) -> bool:
    return h.start_date <= d and (h.archived_at is None or d < h.archived_at)


def is_done(e: Entry | None) -> bool:
    return e is not None and e.state in DONE_STATES


@dataclass
class HabitDay:
    habit: Habit
    entry: Entry | None
    counted: bool  # in the light's denominator unless skipped
    done: bool
    skipped: bool
    week_done: int = 0  # schedule=weekly: done days this week up to and including this day


@dataclass
class DayResult:
    day: date
    mode: Mode | None
    rest: Period | None
    items: list[HabitDay]
    done: int
    total: int
    rate: float | None
    color: str  # green | yellow | red | off (not started / future) | none (no routines) | rest
    by_habit: dict[int, HabitDay] = field(default_factory=dict)


class Book:
    def __init__(self, session: Session, start: date, end: date):
        self.settings = store.settings(session)
        self.today = logical_today(self.settings["day_start_hour"])
        self.start = week_start(start)  # weekly routines look back to Monday
        self.end = end
        self.habits = list(session.exec(select(Habit).order_by(Habit.sort, Habit.id)).all())
        rows = session.exec(select(Entry).where(Entry.day >= self.start, Entry.day <= end)).all()
        self.entries: dict[tuple[int, date], Entry] = {(e.habit_id, e.day): e for e in rows}
        self.modes = {m.id: m for m in session.exec(select(Mode)).all()}
        self.default_mode = next((m for m in self.modes.values() if m.is_default), None)
        # Newest first: a later reservation (e.g. "today only") wins over an older one.
        self.periods = list(session.exec(
            select(Period).where(Period.end >= self.start, Period.start <= end)
            .order_by(Period.created_at.desc(), Period.id.desc())
        ).all())
        self._days: dict[date, DayResult] = {}

    # ---------- one day ----------

    def context(self, d: date) -> tuple[Mode | None, Period | None]:
        mode = rest = None
        for p in self.periods:
            if not p.start <= d <= p.end:
                continue
            if p.kind == "break":
                rest = rest or p
            elif mode is None and p.mode_id in self.modes:
                mode = self.modes[p.mode_id]
        return mode or self.default_mode, rest

    def listed(self, h: Habit, d: date, mode: Mode | None) -> bool:
        if not exists_on(h, d):
            return False
        ids = mode_ids(h)
        if ids and (mode is None or mode.id not in ids):
            return False
        if h.schedule == "days":
            return d.weekday() in weekdays(h)
        return True

    def day(self, d: date) -> DayResult:
        hit = self._days.get(d)
        if hit:
            return hit
        mode, rest = self.context(d)
        items: list[HabitDay] = []
        for h in self.habits:
            if not self.listed(h, d, mode):
                continue
            e = self.entries.get((h.id, d))
            done = is_done(e)
            item = HabitDay(habit=h, entry=e, counted=rest is None, done=done,
                            skipped=e is not None and e.state == "skip")
            if h.schedule == "weekly":
                ws = week_start(d)
                before = sum(is_done(self.entries.get((h.id, x))) for x in daterange(ws, d - timedelta(days=1)))
                item.week_done = before + int(done)
                needed = h.per_week - before
                last_chance = needed > 0 and needed == 7 - d.weekday()
                item.counted = item.counted and (done or last_chance)
            items.append(item)

        if rest:
            done_n = total = 0
        else:
            done_n = sum(i.done for i in items)
            total = sum(1 for i in items if i.done or (i.counted and not i.skipped))
        rate = done_n / total if total else None
        if rest:
            color = "rest"
        elif not total:
            color = "none"
        elif d > self.today or (d == self.today and done_n == 0):
            color = "off"
        elif rate >= self.settings["green_at"]:
            color = "green"
        elif rate >= self.settings["yellow_at"]:
            color = "yellow"
        else:
            color = "red"
        result = DayResult(day=d, mode=mode, rest=rest, items=items, done=done_n, total=total, rate=rate,
                           color=color, by_habit={i.habit.id: i for i in items})
        self._days[d] = result
        return result

    # ---------- streaks ----------

    def day_streak(self, until: date) -> int:
        """Green days in a row up to `until`. Today counts once green; rest/empty days are neutral."""
        n = 0
        for d in _back(until, self.start):
            r = self.day(d)
            if r.color == "green":
                n += 1
            elif r.color in ("rest", "none") or d >= self.today:
                continue
            else:
                break
        return n

    def best_day_streak(self) -> int:
        best = run = 0
        for d in daterange(self.start, min(self.end, self.today)):
            r = self.day(d)
            if r.color == "green":
                run += 1
                best = max(best, run)
            elif r.color not in ("rest", "none") and d < self.today:
                run = 0
        return best

    def _outcome(self, h: Habit, d: date) -> str:
        """done | miss | neutral (not listed, skipped, optional that day, rest, or today still open)."""
        r = self.day(d)
        it = r.by_habit.get(h.id)
        if it is None or r.rest:
            return "neutral"
        if it.done:
            return "done"
        if it.skipped or not it.counted or d >= self.today:
            return "neutral"
        return "miss"

    def habit_streak(self, h: Habit, until: date) -> dict:
        """Current streak with one-miss grace; at_risk = the last chance before it breaks is today."""
        n = misses = 0
        at_risk = False
        seen_past = False
        for d in _back(until, max(self.start, h.start_date)):
            out = self._outcome(h, d)
            if out == "done":
                n += 1
                misses = 0
            elif out == "miss":
                if not seen_past and n == 0:
                    at_risk = True
                misses += 1
                if misses >= 2:
                    break
            if out != "neutral" and d < self.today:
                seen_past = True
        if n == 0:
            at_risk = False
        return {"current": n, "at_risk": at_risk}

    def best_habit_streak(self, h: Habit) -> int:
        best = run = misses = 0
        for d in daterange(max(self.start, h.start_date), min(self.end, self.today)):
            out = self._outcome(h, d)
            if out == "done":
                run += 1
                misses = 0
                best = max(best, run)
            elif out == "miss":
                misses += 1
                if misses >= 2:
                    run = 0
        return best


def _back(start: date, stop: date):
    d = start
    while d >= stop:
        yield d
        d -= timedelta(days=1)
