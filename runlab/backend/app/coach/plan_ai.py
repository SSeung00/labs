"""Plan adjustment: the runner describes a situation, Claude proposes concrete edits to upcoming
workouts. Nothing changes until the runner picks which proposals to apply."""

from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any

from sqlmodel import Session, col, select

from app.analytics import load as load_mod
from app.analytics import readiness as readiness_mod
from app.coach.llm import CoachError, as_json_block, call, text_of
from app.models import Activity, GoalRace, PlannedWorkout
from app.planner.races import upcoming_for_ai
from app.planner.service import active_plan, easy_version, plan_view

WEEKDAYS = "월화수목금토일"
ACTIONS = ["move", "set_distance", "to_easy", "to_rest", "skip"]
DISTANCE_KINDS = {"easy", "long", "recovery"}
LOOKAHEAD_DAYS = 21

SYSTEM = """당신은 러닝 코치입니다. 러너가 처한 상황(일정, 피로, 통증, 날씨 등)을 듣고, 앞으로 3주 안의 \
훈련 계획을 최소한으로 고쳐 제안하세요.

원칙:
- 꼭 필요한 변경만. 고칠 필요가 없으면 changes를 비우고 advice로 설명하세요.
- 포인트 훈련(tempo/interval/mp)과 롱런은 가능하면 지키되, 같은 주 안에서 날짜를 옮기세요. 포인트 훈련끼리는 \
최소 48시간 간격, 롱런 전날은 쉬운 날이 되게 하세요.
- 통증·부상·심한 피로가 있으면 강도를 낮추는 쪽(to_easy, to_rest, skip)을 우선하세요. 통증이 심하면 전문가 상담을 권하세요.
- 레이스(kind=race) 훈련은 절대 바꾸지 마세요. race_calendar의 대회(A=목표, B=중요, C=훈련 삼아) 앞뒤 일정을 고려하세요.
- action 설명:
  - move: 다른 날로 이동 (new_day 필수, 오늘 이후·플랜 기간 안. 그날 이미 훈련이 있으면 그 훈련도 함께 옮기거나 휴식으로 바꾸세요)
  - set_distance: 거리만 조정 (new_km 필수, easy/long/recovery 훈련에만)
  - to_easy: 이지런으로 낮추기 / to_rest: 휴식으로 / skip: 건너뛰기 표시
- workout_id는 주어진 upcoming 목록의 id만 쓰세요.
- 각 change의 reason은 한 문장. summary는 전체 조정을 한두 문장으로. advice는 이번 주를 보내는 요령 2–3문장."""

SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "changes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "workout_id": {"type": "integer"},
                    "action": {"type": "string", "enum": ACTIONS},
                    "new_day": {"type": ["string", "null"]},
                    "new_km": {"type": ["number", "null"]},
                    "reason": {"type": "string"},
                },
                "required": ["workout_id", "action", "new_day", "new_km", "reason"],
                "additionalProperties": False,
            },
        },
        "advice": {"type": "string"},
    },
    "required": ["summary", "changes", "advice"],
    "additionalProperties": False,
}


def _day(d: date) -> str:
    return f"{d.isoformat()} ({WEEKDAYS[d.weekday()]})"


def _km(m: float | None) -> float:
    return round((m or 0) / 1000, 1)


def build_context(session: Session, situation: str, today: date | None = None) -> tuple[dict, dict[int, PlannedWorkout]]:
    today = today or date.today()
    plan = active_plan(session)
    if not plan:
        raise CoachError("활성 훈련 계획이 없어요. 먼저 플랜을 만들어 주세요.")
    view = plan_view(session, plan)
    horizon = today + timedelta(days=LOOKAHEAD_DAYS)
    upcoming = session.exec(
        select(PlannedWorkout).where(
            PlannedWorkout.plan_id == plan.id, PlannedWorkout.day >= today, PlannedWorkout.day <= horizon,
        ).order_by(col(PlannedWorkout.day))
    ).all()
    past = [w for w in view["workouts"] if today - timedelta(days=7) <= w["day"] < today]
    runs = session.exec(
        select(Activity).where(
            col(Activity.sport).contains("run"),
            Activity.start_time >= today - timedelta(days=7),
        ).order_by(col(Activity.start_time))
    ).all()
    race = session.get(GoalRace, plan.goal_race_id) if plan.goal_race_id else None
    readiness = readiness_mod.compute(session, today)
    ctx = {
        "today": _day(today),
        "situation": situation,
        "plan": {
            "name": plan.name, "start": plan.start_day.isoformat(), "end": plan.end_day.isoformat(),
            "race": {"name": race.name, "day": _day(race.race_day), "km": _km(race.distance_m),
                     "goal_time_s": race.target_time_s} if race else None,
            "compliance": view["compliance"],
        },
        "last_7_days": {
            "planned": [{"day": _day(w["day"]), "title": w["title"], "kind": w["kind"], "status": w["status"],
                         "planned_km": _km(w["target_distance_m"]), "actual_km": w["actual_km"]} for w in past],
            "runs": [{"day": _day(a.start_time.date()), "km": _km(a.distance_m), "type": a.run_type,
                      "avg_hr": a.avg_hr, "rpe": a.rpe} for a in runs],
        },
        "upcoming": [
            {"id": w.id, "day": _day(w.day), "kind": w.kind, "title": w.title, "km": _km(w.target_distance_m),
             "phase": w.phase, "status": w.status}
            for w in upcoming
        ],
        "race_calendar": upcoming_for_ai(session),
        "training_load_today": load_mod.today_state(session),
        "readiness_today": {k: readiness.get(k) for k in ("score", "level", "flags")},
    }
    return ctx, {w.id: w for w in upcoming if w.id is not None}


def propose(session: Session, situation: str, client: Any | None = None, today: date | None = None) -> dict:
    situation = situation.strip()
    if not situation:
        raise CoachError("상황을 적어 주세요. 예: 이번 주 수·목 출장이라 못 뛰어요.")
    today = today or date.today()
    ctx, by_id = build_context(session, situation[:1500], today)
    if not by_id:
        raise CoachError("앞으로 3주 안에 계획된 훈련이 없어요.")
    response = call(
        session, "plan", client=client, max_tokens=8000,
        system=SYSTEM, output_format=SCHEMA,
        messages=[{"role": "user", "content": as_json_block("상황과 계획:", ctx)}],
    )
    try:
        out = json.loads(text_of(response))
    except json.JSONDecodeError as e:
        raise CoachError("응답을 해석하지 못했어요. 다시 시도해 주세요.") from e
    plan = active_plan(session)
    changes = []
    for c in out.get("changes", []):
        w = by_id.get(c.get("workout_id"))
        problem = _check(c, w, today, plan.end_day if plan else today)
        if problem:
            continue  # drop proposals that don't fit the plan rather than show something unappliable
        changes.append({
            **c,
            "before": {"day": w.day.isoformat(), "title": w.title, "kind": w.kind, "km": _km(w.target_distance_m)},
        })
    return {"summary": out.get("summary", ""), "advice": out.get("advice", ""), "changes": changes}


def _check(c: dict, w: PlannedWorkout | None, today: date, end: date) -> str | None:
    if w is None:
        return "unknown workout"
    if w.kind == "race":
        return "race is fixed"
    action = c.get("action")
    if action == "move":
        try:
            d = date.fromisoformat((c.get("new_day") or "")[:10])
        except ValueError:
            return "bad day"
        if not (today <= d <= end):
            return "day out of range"
        c["new_day"] = d.isoformat()
    elif action == "set_distance":
        km = c.get("new_km")
        if w.kind not in DISTANCE_KINDS or km is None or not (2 <= km <= 45):
            return "bad distance"
    elif action not in ACTIONS:
        return "bad action"
    return None


def apply(session: Session, changes: list[dict], today: date | None = None) -> int:
    """Apply proposals the runner accepted. Re-validated here; returns how many were applied."""
    today = today or date.today()
    plan = active_plan(session)
    if not plan:
        raise CoachError("활성 훈련 계획이 없어요.")
    n = 0
    for c in changes:
        w = session.get(PlannedWorkout, c.get("workout_id"))
        if w is None or w.plan_id != plan.id or _check(c, w, today, plan.end_day):
            continue
        action = c["action"]
        if action == "move":
            w.day = date.fromisoformat(c["new_day"])
        elif action == "set_distance":
            m = float(c["new_km"]) * 1000
            old_m = w.target_distance_m or m
            pace = (w.structure or [{}])[0].get("pace", "E") if len(w.structure or []) <= 1 else "E"
            label = {"long": "롱런", "recovery": "회복런"}.get(w.kind, "이지런")
            w.target_tss = round((w.target_tss or 0) * m / max(1.0, old_m), 1)
            w.target_distance_m, w.title = m, f"{label} {float(c['new_km']):g}km"
            w.structure = [{"type": "run", "distance_m": m, "pace": pace}]
        elif action == "to_easy":
            easy_version(w)
        elif action == "to_rest":
            w.kind, w.title, w.target_distance_m, w.structure, w.target_tss = "rest", "휴식", 0, [], 0
        elif action == "skip":
            w.status = "skipped"
        session.add(w)
        n += 1
    session.commit()
    return n
