"""Daily check-in metrics (user-defined, EAV) and their built-in defaults."""

from __future__ import annotations

from datetime import date

from sqlmodel import Session, select

from app.models import CustomMetricDef, CustomMetricValue

# polarity: which direction is "good" — used by readiness and insights.
DEFAULT_METRICS: list[dict] = [
    {"key": "sleep_hours", "label": "수면 시간", "kind": "number", "unit": "시간", "icon": "moon", "polarity": "higher_better", "scale_min": 0, "scale_max": 14},
    {"key": "sleep_quality", "label": "수면 질", "kind": "scale", "icon": "bed", "polarity": "higher_better", "scale_min": 1, "scale_max": 5},
    {"key": "fatigue", "label": "피로도", "kind": "scale", "icon": "battery-low", "polarity": "lower_better", "scale_min": 1, "scale_max": 5},
    {"key": "soreness", "label": "근육통", "kind": "scale", "icon": "activity", "polarity": "lower_better", "scale_min": 1, "scale_max": 5},
    {"key": "mood", "label": "기분", "kind": "scale", "icon": "smile", "polarity": "higher_better", "scale_min": 1, "scale_max": 5},
    {"key": "stress", "label": "스트레스", "kind": "scale", "icon": "brain", "polarity": "lower_better", "scale_min": 1, "scale_max": 5},
    {"key": "weight", "label": "체중", "kind": "number", "unit": "kg", "icon": "scale", "polarity": "neutral"},
    {"key": "memo", "label": "한 줄 메모", "kind": "text", "icon": "pen", "polarity": "neutral"},
]


def seed_defaults(session: Session) -> None:
    existing = {d.key for d in session.exec(select(CustomMetricDef))}
    for i, m in enumerate(DEFAULT_METRICS):
        if m["key"] not in existing:
            session.add(CustomMetricDef(**m, sort_order=i, builtin=True))
    session.commit()


def values_for_day(session: Session, day: date) -> dict[str, float | str | None]:
    rows = session.exec(select(CustomMetricValue).where(CustomMetricValue.day == day)).all()
    return {r.metric_key: (r.value_text if r.value_text is not None else r.value_num) for r in rows}
