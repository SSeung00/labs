"""AI analysis of a single run: laps, heart-rate drift, conditions, plan vs. actual, and how it
compares with the runner's recent runs of the same type. Summary numbers only — no GPS."""

from __future__ import annotations

import statistics
from datetime import datetime, timedelta
from typing import Any

import pandas as pd
from sqlmodel import Session, col, select

from app.analytics import load as load_mod
from app.analytics.journal import values_for_day
from app.analytics.profile import ZONE_NAMES, effective_profile
from app.coach.llm import CoachError, as_json_block, call, cost_of, text_of
from app.models import Activity, ActivityInsight, DailyWellness, Gear, Lap, PlannedWorkout

RUN_TYPE_KO = {"race": "레이스", "workout": "포인트 훈련", "long": "장거리", "easy": "조깅", "recovery": "리커버리"}

SYSTEM = """당신은 경험 많은 러닝 코치입니다. 아마추어 러너 한 명의 러닝 1회 기록(요약 수치, 랩, 심박 존, \
날씨, 그날 컨디션, 계획된 훈련, 최근 같은 종류 러닝과의 비교)을 JSON으로 받습니다. 이 데이터만 근거로 \
한국어 분석을 Markdown으로 작성하세요.

형식:
## 한 줄 평
## 페이스·심박 흐름
## 잘된 점
## 다음에 바꿔 볼 점
- 각 섹션 2–4개의 짧은 bullet. 숫자(랩 페이스, 심박, 디커플링 %, 기온 등)를 근거로 인용하세요.
- 페이스는 분:초/km 형식으로 쓰세요 (pace_s_per_km를 변환).
- 랩 흐름에서 패턴을 찾으세요: 네거티브/포지티브 스플릿, 후반 심박 상승(드리프트), 인터벌 반복 간 일관성, 오르막 영향.
- 계획된 훈련이 있으면 목표 대비 실제를 평가하세요. 훈련 종류(조깅인데 너무 빨랐는지, 포인트인데 강도가 충분했는지)에 맞춰 판단하세요.
- 최근 같은 종류 러닝과 비교해 나아졌는지/나빠졌는지 말하세요. 더위·수면 부족 같은 조건 차이를 고려하세요.
- 데이터가 없는 부분은 추측하지 말고 생략하세요. 의학적 진단은 하지 마세요.
- 300단어 이내."""


def _r(v: Any, d: int = 1) -> float | None:
    return None if v is None else round(float(v), d)


def _pace(dist_m: float | None, secs: float | None) -> float | None:
    return round(secs / (dist_m / 1000)) if dist_m and secs else None


def _comparables(session: Session, act: Activity) -> dict | None:
    if not act.run_type:
        return None
    since = act.start_time - timedelta(days=90)
    rows = session.exec(
        select(Activity).where(
            Activity.run_type == act.run_type, Activity.id != act.id,
            Activity.start_time >= since, Activity.start_time < act.start_time + timedelta(days=1),
            col(Activity.sport).contains("run"),
        )
    ).all()
    if len(rows) < 3:
        return {"run_type": act.run_type, "count_last_90d": len(rows), "note": "비교할 기록이 적음"}

    def med(vals: list[float | None]) -> float | None:
        v = [x for x in vals if x is not None]
        return round(statistics.median(v), 2) if v else None

    return {
        "run_type": act.run_type,
        "count_last_90d": len(rows),
        "median_km": med([a.distance_m / 1000 for a in rows]),
        "median_pace_s_per_km": med([_pace(a.distance_m, a.moving_time_s or a.duration_s) for a in rows]),
        "median_avg_hr": med([a.avg_hr for a in rows]),
        "median_ef": med([a.efficiency_factor for a in rows]),
        "median_decoupling_pct": med([a.decoupling_pct for a in rows]),
    }


def _load_state(session: Session, day: datetime) -> dict | None:
    df = load_mod.pmc(session, days=400)
    ts = pd.Timestamp(day.date())
    if ts not in df.index:
        return None
    row = df.loc[ts]
    return {"ctl": _r(row["ctl"]), "atl": _r(row["atl"]), "tsb_morning": _r(row["tsb"]), "acwr": _r(row["acwr"], 2)}


def build_context(session: Session, act: Activity) -> dict:
    prof = effective_profile(session)
    laps = session.exec(select(Lap).where(Lap.activity_id == act.id).order_by(Lap.idx)).all()
    moving = act.moving_time_s or act.duration_s
    planned = session.exec(select(PlannedWorkout).where(PlannedWorkout.matched_activity_id == act.id)).first()
    if planned is None:
        planned = session.exec(
            select(PlannedWorkout).where(PlannedWorkout.day == act.start_time.date(), PlannedWorkout.kind != "rest")
        ).first()
    wellness = session.get(DailyWellness, act.start_time.date())
    shoe = session.get(Gear, act.shoe_id) if act.shoe_id else None
    zones = act.zone_seconds or []
    return {
        "run": {
            "date": act.start_time.strftime("%Y-%m-%d (%a) %H:%M"),
            "name": act.name,
            "type": RUN_TYPE_KO.get(act.run_type or "", act.run_type),
            "km": _r(act.distance_m / 1000, 2),
            "moving_min": _r(moving / 60),
            "pace_s_per_km": _pace(act.distance_m, moving),
            "grade_adjusted_pace_s_per_km": round(1000 / act.gap_speed_mps) if act.gap_speed_mps else None,
            "avg_hr": act.avg_hr, "max_hr": act.max_hr,
            "avg_cadence_spm": act.avg_cadence,
            "elevation_gain_m": act.elevation_gain_m,
            "training_load": _r(act.load, 0),
            "efficiency_factor": _r(act.efficiency_factor, 3),
            "decoupling_pct": _r(act.decoupling_pct),
            "garmin_training_effect": {"aerobic": act.aerobic_te, "anaerobic": act.anaerobic_te},
            "rpe_1_10": act.rpe,
            "note": act.note,
            "shoe": shoe.name if shoe else None,
            "weather": act.weather,
        },
        "laps": [
            {
                "n": lp.idx + 1, "km": _r(lp.distance_m / 1000, 2), "time_s": _r(lp.duration_s, 0),
                "pace_s_per_km": _pace(lp.distance_m, lp.duration_s), "avg_hr": lp.avg_hr,
                "cadence": lp.avg_cadence, "elev_gain_m": lp.elevation_gain_m,
            }
            for lp in laps[:80]
        ],
        "hr_zones": {
            "athlete": {"max_hr": round(prof.max_hr), "lthr": round(prof.lthr), "resting_hr": round(prof.rest_hr)},
            "minutes": {name: _r(sec / 60) for name, sec in zip(ZONE_NAMES, zones, strict=False)},
        },
        "planned_workout": (
            {"title": planned.title, "kind": planned.kind, "target_km": _r((planned.target_distance_m or 0) / 1000),
             "structure": planned.structure, "status": planned.status}
            if planned else None
        ),
        "that_day": {
            "checkin": values_for_day(session, act.start_time.date()) or None,
            "garmin_wellness": (
                {k: v for k, v in wellness.model_dump().items() if v is not None and k != "day"}
                if wellness else None
            ),
            "training_load_state": _load_state(session, act.start_time),
        },
        "recent_same_type": _comparables(session, act),
    }


def analyze(session: Session, activity_id: int, client: Any | None = None) -> ActivityInsight:
    act = session.get(Activity, activity_id)
    if not act:
        raise CoachError("활동을 찾을 수 없어요.")
    ctx = build_context(session, act)
    response = call(
        session, "activity", client=client,
        system=SYSTEM,
        messages=[{"role": "user", "content": as_json_block("이 러닝을 분석해 주세요:", ctx)}],
    )
    text = text_of(response)
    if not text:
        raise CoachError("빈 응답을 받았어요.")
    row = ActivityInsight(
        activity_id=act.id, created_at=datetime.now(), model=response.model, markdown=text,
        cost_usd=round(cost_of(response.model, response.usage), 4),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def latest(session: Session, activity_id: int) -> ActivityInsight | None:
    return session.exec(
        select(ActivityInsight).where(ActivityInsight.activity_id == activity_id).order_by(col(ActivityInsight.created_at).desc())
    ).first()
