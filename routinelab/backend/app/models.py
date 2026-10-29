from datetime import date, datetime

from pydantic import NaiveDatetime
from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class Setting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str | None = None
    updated_at: NaiveDatetime = Field(default_factory=datetime.now)


class Mode(SQLModel, table=True):
    """A set of routines for a situation (weekday, weekend, trip, exam week…)."""

    id: int | None = Field(default=None, primary_key=True)
    name: str
    emoji: str = "🌤️"
    is_default: bool = False  # used on days no period points elsewhere
    sort: int = 0
    created_at: NaiveDatetime = Field(default_factory=datetime.now)


class Period(SQLModel, table=True):
    """A date range that switches the mode (kind='mode') or pauses every routine (kind='break')."""

    id: int | None = Field(default=None, primary_key=True)
    kind: str = "mode"  # mode | break
    mode_id: int | None = Field(default=None, foreign_key="mode.id", ondelete="CASCADE")
    start: date = Field(index=True)
    end: date = Field(index=True)
    note: str = ""
    created_at: NaiveDatetime = Field(default_factory=datetime.now)


class Habit(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    emoji: str = "✅"
    color: str = "green"
    category: str = "life"  # health | exercise | study | mind | life
    slot: str = "anytime"  # morning | day | evening | night | anytime
    kind: str = "check"  # check | count | minutes | number
    target: float = 1
    unit: str = ""
    schedule: str = "daily"  # daily | days | weekly
    days: str = ""  # schedule=days: weekdays as "0,2,4" (Mon=0)
    per_week: int = 3  # schedule=weekly
    easy_name: str = ""  # lighter version for low-energy days; doing it keeps the streak
    cue: str = ""  # habit stacking anchor, e.g. "아침 커피 후"
    reminder: str | None = None  # "HH:MM" push reminder when not done yet
    modes: str = ""  # comma-separated mode ids; empty = every mode
    note: str = ""
    sort: int = 0
    archived: bool = False
    start_date: date = Field(default_factory=date.today)
    archived_at: date | None = None  # history before this day still counts
    created_at: NaiveDatetime = Field(default_factory=datetime.now)


class Entry(SQLModel, table=True):
    """What happened with one habit on one day."""

    __table_args__ = (UniqueConstraint("habit_id", "day"),)

    id: int | None = Field(default=None, primary_key=True)
    habit_id: int = Field(foreign_key="habit.id", index=True, ondelete="CASCADE")
    day: date = Field(index=True)
    value: float = 0
    state: str = ""  # done | easy | skip | "" (not yet / partial)
    note: str = ""
    updated_at: NaiveDatetime = Field(default_factory=datetime.now)


class Todo(SQLModel, table=True):
    id: str = Field(primary_key=True)  # made by the client, so a create queued offline is idempotent
    title: str
    day: date = Field(index=True)
    time: str | None = None  # "HH:MM" places it on the day's timeline
    done: bool = False
    done_at: NaiveDatetime | None = None
    sort: int = 0
    created_at: NaiveDatetime = Field(default_factory=datetime.now)


class DayLog(SQLModel, table=True):
    """The day's reflection: mood, energy, body numbers and answers to the review questions."""

    day: date = Field(primary_key=True)
    mood: int | None = None  # 1–5
    energy: int | None = None  # 1–5
    sleep_hours: float | None = None
    weight: float | None = None
    answers: str = "{}"  # JSON {question: answer}
    note: str = ""
    updated_at: NaiveDatetime = Field(default_factory=datetime.now)


class PushSub(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    endpoint: str = Field(unique=True)
    p256dh: str
    auth: str
    label: str = ""
    created_at: NaiveDatetime = Field(default_factory=datetime.now)
    last_ok: NaiveDatetime | None = None


class Sent(SQLModel, table=True):
    """Reminders already sent (key like 'habit:3:2026-10-29'), so each goes out once."""

    key: str = Field(primary_key=True)
    at: NaiveDatetime = Field(default_factory=datetime.now)
