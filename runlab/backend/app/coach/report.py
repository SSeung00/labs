"""Weekly AI coach report via the Claude API.

Only aggregated statistics are sent (no GPS tracks, no raw streams). The feature is
inert unless Anthropic credentials are available (ANTHROPIC_API_KEY in .env, or an
`ant auth login` profile).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from sqlmodel import Session, col, select

from app.analytics import findings as findings_mod
from app.analytics import load as load_mod
from app.analytics import progress as progress_mod
from app.analytics import readiness as readiness_mod
from app.coach.llm import MODEL, CoachError, as_json_block, call, credentials_available, text_of
from app.models import Activity, CoachReport, CustomMetricValue, Injury
from app.planner.races import upcoming_for_ai
from app.planner.service import active_plan, plan_view

__all__ = ["MODEL", "CoachError", "build_context", "credentials_available", "generate_weekly"]

SYSTEM = """당신은 경험 많은 러닝 코치입니다. 한 명의 아마추어 러너가 직접 만든 훈련 대시보드에서 \
지난 7일간의 요약 데이터를 JSON으로 받습니다. 이 데이터만 근거로 한국어 주간 리포트를 작성하세요.

형식 (Markdown):
## 한 줄 요약
## 이번 주 잘한 점
## 주의할 점
## 다음 주 제안
- 각 섹션은 2–4개의 짧은 bullet. 수치(거리, 페이스, 심박, TSB 등)를 근거로 인용하세요.
- 훈련 계획이 있으면 계획 대비 실제를 평가하고, 다음 주 계획을 어떻게 소화할지 구체적으로 조언하세요.
- 부상이나 낮은 준비도 신호가 있으면 가장 먼저 다루세요. 의학적 진단은 하지 말고, 필요하면 전문가 상담을 권하세요.
- 데이터가 부족한 부분은 추측하지 말고 "기록이 부족해 판단하기 어렵다"고 말하세요.
- 400단어 이내. 격려하되 과장하지 마세요."""


def _r(v, d=1):
    return None if v is None else round(float(v), d)


def build_context(session: Session, today: date | None = None) -> dict:
    today = today or date.today()
    start = today - timedelta(days=6)
    runs = session.exec(
        select(Activity)
        .where(col(Activity.sport).contains("run"), Activity.start_time >= datetime.combine(start, datetime.min.time()))
        .order_by(col(Activity.start_time))
    ).all()
    run_rows = [
        {
            "date": a.start_time.date().isoformat(),
            "name": a.name,
            "km": _r(a.distance_m / 1000, 2),
            "moving_min": _r((a.moving_time_s or a.duration_s) / 60, 0),
            "pace_s_per_km": _r((a.moving_time_s or a.duration_s) / (a.distance_m / 1000), 0) if a.distance_m else None,
            "avg_hr": a.avg_hr,
            "max_hr": a.max_hr,
            "load": _r(a.load, 0),
            "ef": _r(a.efficiency_factor, 3),
            "decoupling_pct": _r(a.decoupling_pct),
            "rpe": a.rpe,
            "temp_c": (a.weather or {}).get("temp_c") if a.weather else None,
            "note": a.note,
        }
        for a in runs
    ]
    weekly = load_mod.weekly(session, 8)
    checkins = session.exec(select(CustomMetricValue).where(CustomMetricValue.day >= start)).all()
    by_day: dict[str, dict] = {}
    for c in checkins:
        by_day.setdefault(c.day.isoformat(), {})[c.metric_key] = c.value_text if c.value_text is not None else c.value_num
    injuries = session.exec(select(Injury).where(Injury.start_day <= today)).all()
    active_inj = [
        {"part": i.body_part, "side": i.side, "severity": i.severity, "since": i.start_day.isoformat(), "note": i.note}
        for i in injuries if not i.end_day or i.end_day >= start
    ]
    pts = progress_mod.vdot_points(session)
    series = progress_mod.fitness_series(session)
    cur = progress_mod.current_state(session, pts, series)

    plan = active_plan(session)
    plan_ctx = None
    if plan:
        view = plan_view(session, plan)
        nxt = today + timedelta(days=7)
        plan_ctx = {
            "name": plan.name,
            "race_day": plan.end_day.isoformat(),
            "compliance": view["compliance"],
            "last_7_days": [
                {"date": w["day"].isoformat() if hasattr(w["day"], "isoformat") else w["day"], "title": w["title"], "status": w["status"], "planned_km": _r((w["target_distance_m"] or 0) / 1000), "actual_km": w["actual_km"]}
                for w in view["workouts"] if start <= (w["day"] if isinstance(w["day"], date) else date.fromisoformat(w["day"])) <= today
            ],
            "next_7_days": [
                {"date": w["day"].isoformat() if hasattr(w["day"], "isoformat") else w["day"], "title": w["title"], "kind": w["kind"], "planned_km": _r((w["target_distance_m"] or 0) / 1000)}
                for w in view["workouts"] if today < (w["day"] if isinstance(w["day"], date) else date.fromisoformat(w["day"])) <= nxt
            ],
        }
    return {
        "period": {"start": start.isoformat(), "end": today.isoformat()},
        "runs": run_rows,
        "weekly_last_8": [{"week": w["week"], "run_km": w["run_km"], "load": w["load"]} for w in weekly],
        "training_load_today": load_mod.today_state(session),
        "readiness_today": {k: v for k, v in readiness_mod.compute(session, today).items() if k in ("score", "level", "flags", "components")},
        "daily_checkins": by_day,
        "injuries": active_inj,
        "fitness": {"vdot": cur["vdot"], "garmin_vo2max": cur["garmin_vo2max"], "predictions": progress_mod.predictions(session, cur["vdot"], None)},
        "plan": plan_ctx,
        "race_calendar": upcoming_for_ai(session, days=120),
        # Clear, distance/temperature-adjusted relationships from this athlete's own data.
        "patterns_found": [{"finding": f["text"], "basis": f["basis"]} for f in findings_mod.compute(session)],
    }


def generate_weekly(session: Session, client: Any | None = None) -> CoachReport:
    ctx = build_context(session)
    response = call(
        session, "weekly", client=client,
        system=SYSTEM,
        messages=[{"role": "user", "content": as_json_block("이번 주 데이터입니다:", ctx)}],
    )
    text = text_of(response)
    if not text:
        raise CoachError("빈 응답을 받았어요.")
    today = date.today()
    report = CoachReport(
        week_start=today - timedelta(days=today.weekday()),
        created_at=datetime.now(),
        model=response.model,
        markdown=text,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
    )
    session.add(report)
    session.commit()
    session.refresh(report)
    return report
