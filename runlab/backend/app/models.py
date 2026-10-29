"""SQLite tables. Per-second streams live in data/streams/{activity_id}.parquet, not here."""

from datetime import date
from typing import Any

from pydantic import NaiveDatetime
from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class Activity(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    garmin_id: int | None = Field(default=None, index=True, unique=True)
    source: str = "garmin"  # garmin | fit_upload
    name: str | None = None
    sport: str = Field(default="running", index=True)
    start_time: NaiveDatetime = Field(index=True)  # local wall-clock time
    start_time_utc: NaiveDatetime | None = Field(default=None, index=True)
    distance_m: float = 0
    duration_s: float = 0
    moving_time_s: float | None = None
    elevation_gain_m: float | None = None
    avg_hr: float | None = None
    max_hr: float | None = None
    avg_speed_mps: float | None = None
    avg_cadence: float | None = None
    calories: float | None = None
    start_lat: float | None = None
    start_lon: float | None = None
    # Garmin-provided
    aerobic_te: float | None = None
    anaerobic_te: float | None = None
    vo2max: float | None = None
    # Computed by analytics
    gap_speed_mps: float | None = None
    trimp: float | None = None
    hr_tss: float | None = None
    efficiency_factor: float | None = None
    decoupling_pct: float | None = None
    zone_seconds: list[float] | None = Field(default=None, sa_column=Column(JSON(none_as_null=True)))
    load: float | None = None  # training stress used for CTL/ATL (hrTSS, else sRPE/duration estimate)
    load_source: str | None = None  # hr | rpe | duration
    vdot_est: float | None = None  # HR-adjusted VDOT for this run
    metrics_version: int | None = None
    # Training type: race | workout | easy | recovery | long
    run_type: str | None = Field(default=None, index=True)
    run_type_source: str | None = None  # auto | import | manual
    run_type_confidence: float | None = None
    run_type_reason: str | None = None
    # Enrichment / user input
    weather: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON(none_as_null=True)))
    shoe_id: int | None = Field(default=None, foreign_key="gear.id")
    rpe: int | None = None
    note: str | None = None
    has_stream: bool = False


class Lap(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    activity_id: int = Field(foreign_key="activity.id", index=True)
    idx: int
    distance_m: float
    duration_s: float
    avg_hr: float | None = None
    avg_speed_mps: float | None = None
    avg_cadence: float | None = None
    elevation_gain_m: float | None = None


class DailyWellness(SQLModel, table=True):
    day: date = Field(primary_key=True)
    resting_hr: float | None = None
    hrv_avg: float | None = None
    hrv_status: str | None = None
    sleep_total_s: float | None = None
    sleep_deep_s: float | None = None
    sleep_rem_s: float | None = None
    sleep_score: float | None = None
    body_battery_max: float | None = None
    body_battery_min: float | None = None
    stress_avg: float | None = None
    steps: int | None = None
    weight_kg: float | None = None
    training_readiness: float | None = None


class BestEffort(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    activity_id: int = Field(foreign_key="activity.id", index=True)
    distance_m: float = Field(index=True)
    time_s: float
    start_offset_s: float | None = None


class AthleteProfile(SQLModel, table=True):
    """One row per effective date so zone changes keep history."""

    id: int | None = Field(default=None, primary_key=True)
    effective_from: date
    max_hr: float | None = None
    resting_hr: float | None = None
    lthr: float | None = None
    vdot: float | None = None  # manual override; otherwise estimated
    sex: str = "male"  # TRIMP weighting
    hr_zone_method: str = "lthr"  # lthr | karvonen | max
    zone_bounds: list[float] | None = Field(default=None, sa_column=Column(JSON(none_as_null=True)))


class CustomMetricDef(SQLModel, table=True):
    key: str = Field(primary_key=True)
    label: str
    kind: str = "number"  # number | scale | bool | text | select
    unit: str | None = None
    icon: str | None = None
    options: list[str] | None = Field(default=None, sa_column=Column(JSON(none_as_null=True)))
    scale_min: float | None = None
    scale_max: float | None = None
    polarity: str | None = None  # higher_better | lower_better | neutral
    sort_order: int | None = None
    builtin: bool | None = None
    archived: bool = False


class CustomMetricValue(SQLModel, table=True):
    day: date = Field(primary_key=True)
    metric_key: str = Field(primary_key=True, foreign_key="custommetricdef.key")
    value_num: float | None = None
    value_text: str | None = None


class Injury(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    body_part: str
    side: str | None = None  # left | right | both
    map_x: float | None = None
    map_y: float | None = None
    severity: int = 1  # 1-5
    start_day: date
    end_day: date | None = None
    note: str | None = None


class Gear(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    brand: str | None = None
    purchased_on: date | None = None
    retire_at_km: float = 700
    initial_km: float = 0
    retired: bool = False
    garmin_gear_uuid: str | None = None
    is_default: bool | None = None  # auto-assigned to newly synced runs
    color: str | None = None
    color2: str | None = None
    note: str | None = None


class GoalRace(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    race_day: date
    distance_m: float
    target_time_s: float | None = None
    priority: str = "A"  # A (goal) | B (important: mini-taper + recovery) | C (training race)
    result_activity_id: int | None = Field(default=None, foreign_key="activity.id")
    location: str | None = None
    note: str | None = None


class Plan(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    goal_race_id: int | None = Field(default=None, foreign_key="goalrace.id")
    start_day: date
    end_day: date
    params: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON(none_as_null=True)))
    active: bool = True


class PlannedWorkout(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    plan_id: int | None = Field(default=None, foreign_key="plan.id", index=True)
    day: date = Field(index=True)
    kind: str  # easy | long | tempo | interval | mp | recovery | rest | cross | race
    title: str
    phase: str | None = None  # base | build | peak | taper
    target_distance_m: float | None = None
    target_duration_s: float | None = None
    target_tss: float | None = None
    structure: list[dict[str, Any]] | None = Field(default=None, sa_column=Column(JSON(none_as_null=True)))
    matched_activity_id: int | None = Field(default=None, foreign_key="activity.id")
    status: str = "planned"  # planned | done | partial | missed | skipped
    note: str | None = None
    garmin_workout_id: int | None = None  # set after "send to Garmin"
    race_id: int | None = Field(default=None, foreign_key="goalrace.id")  # race-day workout for this race


class SyncState(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str | None = None
    updated_at: NaiveDatetime | None = None


class CoachReport(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    week_start: date = Field(index=True)
    created_at: NaiveDatetime
    model: str
    markdown: str
    input_tokens: int | None = None
    output_tokens: int | None = None


class AiUsage(SQLModel, table=True):
    """One row per Claude API call, for the spend meter and budget cap."""

    id: int | None = Field(default=None, primary_key=True)
    created_at: NaiveDatetime = Field(index=True)
    feature: str  # weekly | activity | journal | plan | chat
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    cost_usd: float = 0.0


class ActivityInsight(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    activity_id: int = Field(foreign_key="activity.id", index=True)
    created_at: NaiveDatetime
    model: str
    markdown: str
    cost_usd: float | None = None


class CoachChat(SQLModel, table=True):
    """A coach conversation. `messages` is the exact, append-only API history (incl. tool turns)."""

    id: int | None = Field(default=None, primary_key=True)
    created_at: NaiveDatetime
    updated_at: NaiveDatetime
    title: str
    messages: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    cost_usd: float = 0.0
    model: str | None = None  # fixed at the first turn so replayed thinking stays with its model


class FitnessSnapshot(SQLModel, table=True):
    """What the app said about fitness on a day: kept so predictions and plan outlook have a history."""

    day: date = Field(primary_key=True)
    vdot: float | None = None
    vdot_sd: float | None = None
    ctl: float | None = None
    atl: float | None = None
    tsb: float | None = None
    predictions: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))  # distance_m → seconds
    goal: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))  # race, target, predicted, on-track %
    updated_at: NaiveDatetime | None = None
