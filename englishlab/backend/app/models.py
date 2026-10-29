"""Tables. JSON columns hold AI output as returned (validated by the json_schema it was asked for).

Reassign JSON values (row.data = {...}) instead of mutating them in place, so SQLAlchemy sees the change.
"""

from datetime import date
from typing import Any

from pydantic import NaiveDatetime
from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel

# Skill keys used for levels. Level values are on a 1.0–6.0 scale: A1=1 … C2=6 (same as TOEFL bands).
SKILLS = ("reading", "listening", "speaking", "writing", "vocab")

# Activity.kind — what was studied; minutes from these feed the daily goal and the input-hours total.
ACTIVITY_KINDS = ("review", "read", "listen", "talk", "write", "placement", "drill", "external")
# Plan blocks: what the weekly plan and the 오늘 course are measured in (book study has its own block).
BLOCKS = ("review", "read", "listen", "talk", "write", "book")
INPUT_KINDS = ("read", "listen", "external")  # count toward "input hours"


def _json(default: Any = None):
    factory = (lambda: default.copy()) if isinstance(default, (dict, list)) else (lambda: default)
    return Field(default_factory=factory, sa_column=Column(JSON))


class Setting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str | None = None
    updated_at: NaiveDatetime | None = None


class AiUsage(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    created_at: NaiveDatetime = Field(index=True)
    feature: str = Field(index=True)
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    cost_usd: float = 0.0  # billed (API only; counts toward the monthly budget)
    provider: str = "api"  # api | cli
    equiv_usd: float = 0.0  # CLI calls: what the call would have cost on the API (paid by the subscription)


class LevelRecord(SQLModel, table=True):
    """One estimate of one skill at a point in time (placement test, conversation report, …)."""

    id: int | None = Field(default=None, primary_key=True)
    created_at: NaiveDatetime = Field(index=True)
    skill: str = Field(index=True)
    level: float  # 1.0–6.0
    source: str  # placement | talk | reading | writing | manual
    note: str | None = None


class Placement(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    created_at: NaiveDatetime
    finished_at: NaiveDatetime | None = None
    # Generated test material (reading passages, dictation sentences, speaking/writing prompts).
    material: dict = _json({})
    # Learner answers per section, and the vocabulary yes/no test.
    answers: dict = _json({})
    result: dict | None = _json(None)


class Card(SQLModel, table=True):
    """A spaced-repetition card. kind: word | phrase | correction."""

    id: int | None = Field(default=None, primary_key=True)
    created_at: NaiveDatetime
    kind: str = "word"
    term: str = Field(index=True)  # word/phrase, or the corrected sentence for corrections
    lemma: str | None = Field(default=None, index=True)
    context: str | None = None  # sentence it was met in (term appears in it)
    prompt: str | None = None  # corrections: the learner's original wording
    meaning_ko: str | None = None
    definition_en: str | None = None
    ipa: str | None = None
    examples: list = _json([])  # [{en, ko}]
    note: str | None = None  # collocations, register, why the correction
    source_kind: str | None = None  # reading | talk | placement | manual
    source_id: int | None = None
    enriched: bool = False
    suspended: bool = False
    # FSRS state (fsrs.Card.to_dict()); due is copied out for querying.
    fsrs: dict = _json({})
    due: NaiveDatetime = Field(index=True)
    reps: int = 0
    lapses: int = 0


class ReviewLog(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    card_id: int = Field(foreign_key="card.id", index=True, ondelete="CASCADE")
    reviewed_at: NaiveDatetime = Field(index=True)
    rating: int  # 1 again, 2 hard, 3 good, 4 easy
    duration_ms: int | None = None


class KnownWord(SQLModel, table=True):
    """Explicit word status overriding the frequency-based estimate. status: known | unknown | ignore."""

    lemma: str = Field(primary_key=True)
    status: str
    updated_at: NaiveDatetime


class Gloss(SQLModel, table=True):
    """Cached quick lookup of a word/phrase in a given sentence (tap-to-translate)."""

    id: int | None = Field(default=None, primary_key=True)
    key: str = Field(index=True, unique=True)  # hash of term + sentence
    term: str
    data: dict = _json({})
    created_at: NaiveDatetime


class Reading(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    created_at: NaiveDatetime = Field(index=True)
    title: str
    source_kind: str  # url | text | topic
    source_url: str | None = None
    original: str | None = None
    mode: str = "adapt"  # adapt (rewritten to level) | gloss (original kept, notes added)
    target_level: float | None = None
    body: str = ""  # the text to read: paragraphs separated by blank lines
    data: dict = _json({})  # glossary, expressions, questions, summary_ko, talk_prompt
    word_count: int = 0
    coverage: float | None = None  # share of tokens estimated known when created
    finished_at: NaiveDatetime | None = None
    minutes: float = 0.0
    quiz_score: float | None = None


class Conversation(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    created_at: NaiveDatetime = Field(index=True)
    ended_at: NaiveDatetime | None = None
    mode: str  # free | roleplay | interview | reading
    title: str
    scenario: dict = _json({})  # role, setting, goal, opening line …
    reading_id: int | None = None
    report: dict | None = _json(None)
    metrics: dict = _json({})
    minutes: float = 0.0


class Message(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    conversation_id: int = Field(foreign_key="conversation.id", index=True, ondelete="CASCADE")
    created_at: NaiveDatetime
    role: str  # user | assistant
    text: str
    # user turns: speech stats and silent corrections; assistant turns: the nudge shown (if any)
    audio_seconds: float | None = None
    words: int | None = None
    data: dict = _json({})
    replaced: bool = False  # superseded by a retry (self-correction)


class Mistake(SQLModel, table=True):
    """A recurring error pattern, merged across conversations by pattern key."""

    id: int | None = Field(default=None, primary_key=True)
    created_at: NaiveDatetime
    last_seen: NaiveDatetime = Field(index=True)
    pattern: str = Field(index=True)  # short English label, e.g. "past tense after 'yesterday'"
    category: str  # grammar | vocabulary | naturalness | pronunciation
    example_wrong: str
    example_right: str
    explanation_ko: str
    count: int = 1
    card_id: int | None = None
    resolved: bool = False


class Activity(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    created_at: NaiveDatetime = Field(index=True)
    day: date = Field(index=True)
    kind: str
    minutes: float = 0.0
    ref_id: int | None = None
    note: str | None = None
    book_id: int | None = Field(default=None, index=True)  # study from a book the learner added


class DayRecord(SQLModel, table=True):
    """Attendance: one row per day the streak was kept, either by studying or by a freeze."""

    day: date = Field(primary_key=True)
    frozen: bool = False
    goal_met: bool = False


class Achievement(SQLModel, table=True):
    key: str = Field(primary_key=True)
    achieved_at: NaiveDatetime
    seen: bool = False


class Book(SQLModel, table=True):
    """A book the learner studies alongside the app (e.g. a TOEFL reading prep book), researched by AI."""

    id: int | None = Field(default=None, primary_key=True)
    created_at: NaiveDatetime
    title: str
    author: str | None = None
    notes: str | None = None  # what the learner told us (edition, why they bought it, …)
    status: str = "researching"  # researching | ready | active | paused | done | error
    error: str | None = None
    skill: str = "reading"  # reading | listening | speaking | writing | vocab | grammar | mixed
    info: dict = _json({})  # AI research result
    unit_label: str = "Unit"
    units: list = _json([])  # [{title, minutes}]
    units_done: list = _json([])  # indices of finished units
    start_date: date | None = None
    end_date: date | None = None
    days_per_week: int = 5
    minutes_per_session: int = 45


class BookSession(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    book_id: int = Field(foreign_key="book.id", index=True, ondelete="CASCADE")
    created_at: NaiveDatetime
    day: date
    minutes: float = 0.0
    units: list = _json([])  # unit indices finished in this session
    score: float | None = None  # 0–1 share correct, if the session had exercises
    band: float | None = None  # a full mock test scored on the 1–6 band scale
    note: str | None = None


class StudyPlan(SQLModel, table=True):
    """The learner's plan from now to the target date: phases with weekly minutes per block, milestones."""

    id: int | None = Field(default=None, primary_key=True)
    created_at: NaiveDatetime
    active: bool = False
    status: str = "generating"  # generating | ready | error
    error: str | None = None
    note: str | None = None  # what the learner asked for when making it
    start: date
    end: date
    goal: dict = _json({})  # {reading, listening, speaking, writing} target levels at the end date
    phases: list = _json([])  # [{name_ko, start, end, focus_ko, weekly_minutes{block: min}, targets_ko}]
    milestones: list = _json([])  # [{date, title_ko, skill_targets{skill: level}, check_ko}]
    routine: list = _json([])  # [{day, items[{block, minutes, what_ko}]}]
    data: dict = _json({})  # summary, realistic goal, tips, the forecast it was made from
    checkins: dict = _json({})  # ISO week → AI weekly check-in


class Ink(SQLModel, table=True):
    """Pen strokes: annotations on a reading, or a handwritten note page (vector, so it stays sharp)."""

    id: int | None = Field(default=None, primary_key=True)
    created_at: NaiveDatetime
    updated_at: NaiveDatetime = Field(index=True)
    scope: str = Field(index=True)  # reading (annotations) | note | book | writing
    ref_id: int | None = Field(default=None, index=True)
    title: str | None = None
    strokes: list = _json([])
    highlights: list = _json([])  # readings: [{p, a, b, c}] word ranges marked with the highlighter
    height: float = 0.0  # note pages: logical height (width is fixed at 1000)


class Writing(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    created_at: NaiveDatetime = Field(index=True)
    task: str  # email | discussion | journal | free
    prompt: str
    text: str  # what the learner wrote (transcribed when handwritten)
    handwritten: bool = False
    minutes: float = 0.0
    result: dict = _json({})
