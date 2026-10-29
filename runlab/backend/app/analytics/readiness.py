"""Readiness from training load + the daily self check-in (no overnight watch data).

Score 0–100. Load freshness always contributes; the check-in, when present, carries
more weight because it captures sleep and how the body actually feels.
"""

from __future__ import annotations

from datetime import date, timedelta

from sqlmodel import Session, col, or_, select

from app.analytics.journal import values_for_day
from app.analytics.load import today_state
from app.models import Injury


def _lerp(x: float, x0: float, x1: float, y0: float, y1: float) -> float:
    if x1 == x0:
        return y0
    t = min(max((x - x0) / (x1 - x0), 0.0), 1.0)
    return y0 + t * (y1 - y0)


def freshness_score(tsb: float) -> float:
    """TSB −30 → 10, −10 → 50, 0 → 70, +10 → 90; very high TSB plateaus (detraining isn't 'more ready')."""
    if tsb <= -10:
        return _lerp(tsb, -30, -10, 10, 50)
    if tsb <= 0:
        return _lerp(tsb, -10, 0, 50, 70)
    return _lerp(tsb, 0, 10, 70, 90)


def scale_score(v: float, lo: float = 1, hi: float = 5, higher_better: bool = True) -> float:
    s = _lerp(v, lo, hi, 0, 100)
    return s if higher_better else 100 - s


def compute(session: Session, day: date | None = None) -> dict:
    day = day or date.today()
    load = today_state(session)
    checkin = values_for_day(session, day)
    components: list[dict] = []

    fresh = freshness_score(load["tsb"])
    components.append({"key": "load", "label": "훈련 부하 (TSB)", "score": round(fresh), "detail": f"TSB {load['tsb']:+.0f}"})

    sub_scores: list[float] = []
    if (h := checkin.get("sleep_hours")) is not None:
        s = _lerp(float(h), 5, 8, 15, 100)
        sub_scores.append(s)
        components.append({"key": "sleep_hours", "label": "수면 시간", "score": round(s), "detail": f"{float(h):.1f}시간"})
    for key, label, hb in (
        ("sleep_quality", "수면 질", True),
        ("fatigue", "피로도", False),
        ("soreness", "근육통", False),
        ("mood", "기분", True),
        ("stress", "스트레스", False),
    ):
        if (v := checkin.get(key)) is not None:
            s = scale_score(float(v), higher_better=hb)
            sub_scores.append(s)
            components.append({"key": key, "label": label, "score": round(s), "detail": f"{int(float(v))}/5"})

    if sub_scores:
        subjective = sum(sub_scores) / len(sub_scores)
        score = 0.4 * fresh + 0.6 * subjective
    else:
        score = fresh

    flags: list[str] = []
    acwr = load.get("acwr")
    if acwr and acwr > 1.5:
        score -= 10
        flags.append(f"최근 1주 부하가 4주 평균의 {acwr:.1f}배예요 (부상 위험 구간)")
    elif acwr and acwr > 1.3:
        score -= 4
        flags.append(f"부하가 빠르게 늘고 있어요 (ACWR {acwr:.2f})")
    if (s := checkin.get("soreness")) is not None and float(s) >= 4:
        flags.append("근육통이 심해요 — 고강도는 미루세요")
    active_injuries = session.exec(
        select(Injury).where(Injury.start_day <= day, or_(col(Injury.end_day).is_(None), Injury.end_day >= day))
    ).all()
    if active_injuries:
        score -= 10
        flags.append("진행 중인 부상: " + ", ".join(i.body_part for i in active_injuries))

    score = max(0.0, min(100.0, score))
    if score >= 75:
        level, advice = "high", "컨디션 좋아요. 계획된 고강도 훈련을 소화하기 좋은 날이에요."
    elif score >= 55:
        level, advice = "ok", "계획대로 진행해도 좋아요."
    elif score >= 40:
        level, advice = "low", "강도를 한 단계 낮추거나 거리를 줄이세요."
    else:
        level, advice = "very_low", "회복이 우선이에요. 휴식이나 아주 가벼운 조깅을 권해요."

    yesterday = values_for_day(session, day - timedelta(days=1))
    return {
        "day": day.isoformat(),
        "score": round(score),
        "level": level,
        "advice": advice,
        "flags": flags,
        "components": components,
        "has_checkin": bool(sub_scores),
        "load": load,
        "checkin": checkin,
        "yesterday_checkin": bool(yesterday),
    }
