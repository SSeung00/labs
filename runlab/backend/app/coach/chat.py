"""Ask-the-coach chat. Claude answers from the runner's own records through read-only tools.

The conversation is stored exactly as sent to the API (append-only, including tool turns and
thinking blocks) so follow-up questions replay the same history.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Any

import pandas as pd
from sqlmodel import Session, col, select

from app.analytics import load as load_mod
from app.analytics import progress as progress_mod
from app.analytics.profile import effective_profile
from app.coach import activity as activity_ai
from app.coach.llm import CoachError, call, cost_of, feature_config
from app.models import Activity, CoachChat, CustomMetricValue, DailyWellness, Gear, GoalRace
from app.planner.races import upcoming_for_ai
from app.planner.service import active_plan, plan_view

MAX_STEPS = 8
MAX_TURNS = 30  # user messages per conversation; start a new one after that
WEEKDAYS = "월화수목금토일"

SYSTEM = """당신은 한 아마추어 러너의 전담 러닝 코치입니다. 러너가 직접 만든 훈련 앱(RunLab)에 쌓인 기록을 \
도구로 조회해서 질문에 답합니다.

- 숫자로 답할 수 있는 질문은 반드시 도구로 실제 기록을 확인한 뒤 답하세요. 기억이나 추측으로 수치를 만들지 마세요.
- 필요한 만큼만 조회하세요. 기간을 좁혀 부르는 편이 좋습니다.
- 페이스는 분:초/km, 시간은 시:분:초로 쓰세요. pace_s_per_km 같은 초 단위 값은 변환해서 보여주세요.
- 답은 한국어로, 핵심부터. 표가 도움이 되면 Markdown 표를 써도 됩니다. 보통 250단어 이내.
- 훈련 조언은 데이터(부하, TSB, 준비도, 부상 기록)를 근거로 구체적으로. 의학적 진단은 하지 말고 필요하면 전문가 상담을 권하세요.
- 기록으로 알 수 없는 것은 모른다고 말하세요.
- 앱의 데이터는 바꿀 수 없습니다. 계획 변경이 필요하면 '훈련 계획 → AI로 조정'을 쓰라고 안내하세요."""


def _r(v: Any, d: int = 1) -> float | None:
    return None if v is None or (isinstance(v, float) and pd.isna(v)) else round(float(v), d)


def _pace(dist_m: float | None, secs: float | None) -> int | None:
    return round(secs / (dist_m / 1000)) if dist_m and secs else None


def _dates(start: str | None, end: str | None, default_days: int) -> tuple[date, date]:
    try:
        e = date.fromisoformat(end) if end else date.today()
    except ValueError:
        e = date.today()
    try:
        s = date.fromisoformat(start) if start else e - timedelta(days=default_days)
    except ValueError:
        s = e - timedelta(days=default_days)
    return min(s, e), max(s, e)


# ---------- tools (read-only) ----------

def t_list_runs(session: Session, start_date: str | None = None, end_date: str | None = None,
                run_type: str | None = None) -> Any:
    s, e = _dates(start_date, end_date, 30)
    stmt = select(Activity).where(
        col(Activity.sport).contains("run"),
        Activity.start_time >= datetime.combine(s, datetime.min.time()),
        Activity.start_time < datetime.combine(e + timedelta(days=1), datetime.min.time()),
    )
    if run_type:
        stmt = stmt.where(Activity.run_type == run_type)
    rows = session.exec(stmt.order_by(col(Activity.start_time))).all()
    shoes = {g.id: g.name for g in session.exec(select(Gear))}
    out = [
        {
            "id": a.id, "date": a.start_time.strftime("%Y-%m-%d %H:%M"), "name": a.name, "type": a.run_type,
            "km": _r(a.distance_m / 1000, 2), "pace_s_per_km": _pace(a.distance_m, a.moving_time_s or a.duration_s),
            "avg_hr": a.avg_hr, "load": _r(a.load, 0), "ef": _r(a.efficiency_factor, 3),
            "decoupling_pct": _r(a.decoupling_pct), "temp_c": (a.weather or {}).get("temp_c"),
            "rpe": a.rpe, "shoe": shoes.get(a.shoe_id),
        }
        for a in rows
    ]
    if len(out) > 150:
        return {"note": f"{len(out)}개 중 최근 150개만 보여줍니다. 기간을 좁히세요.", "runs": out[-150:]}
    return {"period": [s.isoformat(), e.isoformat()], "count": len(out), "runs": out}


def t_run_detail(session: Session, activity_id: int) -> Any:
    act = session.get(Activity, activity_id)
    if not act:
        return {"error": "그런 활동이 없어요."}
    return activity_ai.build_context(session, act)


def t_weekly(session: Session, weeks: int = 12) -> Any:
    weeks = max(1, min(int(weeks), 104))
    rows = load_mod.weekly(session, weeks)
    return [
        {"week_start": w["week"], "run_km": w["run_km"], "load": w["load"], "monotony": w["monotony"],
         "zone_minutes": [round(s / 60) for s in w["zone_seconds"]]}
        for w in rows
    ]


def t_monthly(session: Session) -> Any:
    from app.routers.activities import monthly  # route function is plain Python

    return [
        {"month": m["month"], "runs": m["count"], "km": round(m["distance_m"] / 1000, 1),
         "hours": round(m["duration_s"] / 3600, 1),
         "km_by_type": {k: round(v / 1000, 1) for k, v in m["by_type"].items()}}
        for m in monthly(session)
    ]


def t_fitness(session: Session, days: int = 120) -> Any:
    days = max(14, min(int(days), 730))
    df = load_mod.pmc(session, days=days)
    weekly_rows = df.resample("W-SUN").last() if len(df) else df
    pts = progress_mod.vdot_points(session)
    series = progress_mod.fitness_series(session)
    cur = progress_mod.current_state(session, pts, series)
    since = pd.Timestamp(date.today() - timedelta(days=days))
    vser = series[series["day"] >= since] if len(series) else series
    return {
        "today": load_mod.today_state(session),
        "weekly_ctl_atl_tsb": [
            {"week_end": i.date().isoformat(), "ctl": _r(r["ctl"]), "atl": _r(r["atl"]), "tsb": _r(r["tsb"])}
            for i, r in weekly_rows.iterrows()
        ],
        "vdot_now": cur,
        "vdot_trend_weekly": [
            {"day": r["day"].date().isoformat(), "vdot": _r(r["v"])}
            for _, r in (vser.set_index("day").resample("W-SUN").last().dropna().reset_index().iterrows() if len(vser) else [])
        ],
        "race_predictions": [
            {"distance": p["label"], "consensus_time_s": p.get("consensus_s")}
            for p in progress_mod.predictions(session, cur["vdot"], None)
        ],
        "personal_records": [
            {"distance": p["label"], "time_s": p["best"]["time_s"], "date": p["best"]["day"]}
            for p in progress_mod.personal_records(session) if p["best"]
        ],
    }


def t_wellness(session: Session, start_date: str | None = None, end_date: str | None = None) -> Any:
    s, e = _dates(start_date, end_date, 14)
    if (e - s).days > 120:
        s = e - timedelta(days=120)
    w = {r.day: r for r in session.exec(select(DailyWellness).where(DailyWellness.day >= s, DailyWellness.day <= e))}
    c: dict[date, dict] = {}
    for v in session.exec(select(CustomMetricValue).where(CustomMetricValue.day >= s, CustomMetricValue.day <= e)):
        c.setdefault(v.day, {})[v.metric_key] = v.value_text if v.value_text is not None else v.value_num
    out = []
    d = s
    while d <= e:
        g = w.get(d)
        row: dict[str, Any] = {"day": d.isoformat()}
        if g:
            row.update({
                "resting_hr": g.resting_hr, "hrv": g.hrv_avg, "sleep_h": _r((g.sleep_total_s or 0) / 3600) or None,
                "sleep_score": g.sleep_score, "stress": g.stress_avg, "garmin_readiness": g.training_readiness,
            })
        if d in c:
            row["checkin"] = c[d]
        if len(row) > 1:
            out.append(row)
        d += timedelta(days=1)
    return out


def t_plan(session: Session) -> Any:
    plan = active_plan(session)
    if not plan:
        return {"plan": None, "race_calendar": upcoming_for_ai(session, days=400)}
    view = plan_view(session, plan)
    race = session.get(GoalRace, plan.goal_race_id) if plan.goal_race_id else None
    today = date.today()
    return {
        "name": plan.name,
        "race": {"name": race.name, "day": race.race_day.isoformat(), "km": round(race.distance_m / 1000, 1),
                 "goal_time_s": race.target_time_s} if race else None,
        "compliance": view["compliance"],
        "race_calendar": upcoming_for_ai(session, days=400),
        "weeks": [{"week_start": w["week_start"], "phase": w["phase"], "planned_km": w["planned_km"],
                   "actual_km": w["actual_km"]} for w in view["weeks"]],
        "next_14_days": [
            {"day": w["day"].isoformat(), "kind": w["kind"], "title": w["title"],
             "km": round((w["target_distance_m"] or 0) / 1000, 1), "structure": w["structure"]}
            for w in view["workouts"] if today <= w["day"] <= today + timedelta(days=14)
        ],
    }


def t_gear(session: Session) -> Any:
    from app.routers.gear import list_gear

    return [
        {"name": g["name"], "brand": g.get("brand"), "km": round(g.get("km") or 0), "runs": g.get("runs"),
         "retired": g.get("retired"), "avg_pace_s_per_km": g.get("avg_pace_s_per_km"), "avg_ef": g.get("avg_ef"),
         "last_used": g.get("last_used")}
        for g in list_gear(session)
    ]


def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or list(props), "additionalProperties": False}


DATE = {"type": ["string", "null"], "description": "YYYY-MM-DD. null이면 기본 기간"}
TOOLS: list[dict] = [
    {"name": "list_runs", "description": "기간 안의 러닝 목록(날짜, 종류, 거리, 페이스, 심박, 부하, EF, 디커플링, 기온, RPE, 신발). 기본 최근 30일.",
     "input_schema": _obj({"start_date": DATE, "end_date": DATE,
                           "run_type": {"anyOf": [{"type": "string", "enum": ["race", "workout", "long", "easy", "recovery"]},
                                                  {"type": "null"}]}})},
    {"name": "run_detail", "description": "러닝 1회의 상세: 랩별 페이스·심박, 심박 존, 날씨, 그날 컨디션, 계획 대비, 최근 같은 종류 비교.",
     "input_schema": _obj({"activity_id": {"type": "integer"}})},
    {"name": "weekly_summary", "description": "최근 N주(월요일 시작) 주간 거리, 훈련 부하, 단조로움, 심박 존별 분.",
     "input_schema": _obj({"weeks": {"type": "integer"}})},
    {"name": "monthly_summary", "description": "전체 기간의 월별 러닝 횟수·거리·시간·종류별 거리.", "input_schema": _obj({})},
    {"name": "fitness", "description": "체력 흐름: 오늘의 CTL/ATL/TSB, 주별 CTL/ATL/TSB, 현재 VDOT과 추세, 레이스 기록 예측, 개인 최고 기록.",
     "input_schema": _obj({"days": {"type": "integer"}})},
    {"name": "wellness", "description": "일별 컨디션: 가민(안정 심박, HRV, 수면, 스트레스, 준비도) + 직접 쓴 체크인. 기본 최근 14일, 최대 120일.",
     "input_schema": _obj({"start_date": DATE, "end_date": DATE})},
    {"name": "training_plan", "description": "현재 훈련 계획과 대회 일정: 목표 레이스, 앞으로의 대회(A/B/C), 이행률, 주별 계획/실제 거리, 앞으로 14일 훈련.", "input_schema": _obj({})},
    {"name": "shoes", "description": "신발 목록과 누적 거리, 신발별 평균 페이스·EF.", "input_schema": _obj({})},
]
for _t in TOOLS:
    _t["strict"] = True

HANDLERS = {
    "list_runs": t_list_runs, "run_detail": t_run_detail, "weekly_summary": t_weekly,
    "monthly_summary": t_monthly, "fitness": t_fitness, "wellness": t_wellness,
    "training_plan": t_plan, "shoes": t_gear,
}


def _run_tool(session: Session, name: str, args: dict) -> tuple[str, bool]:
    fn = HANDLERS.get(name)
    if not fn:
        return f"알 수 없는 도구: {name}", True
    try:
        return json.dumps(fn(session, **args), ensure_ascii=False, default=str), False
    except Exception as e:  # report to the model instead of failing the whole turn
        return f"조회 중 오류: {type(e).__name__}: {e}", True


def _profile_note(session: Session) -> str:
    prof = effective_profile(session)
    today = date.today()
    return (
        f"[오늘 {today.isoformat()} ({WEEKDAYS[today.weekday()]}) · 최대 심박 {round(prof.max_hr)}, "
        f"LTHR {round(prof.lthr)}, 안정 심박 {round(prof.rest_hr)}]"
    )


# ---------- conversation ----------

def send(session: Session, chat_id: int | None, text: str, client: Any | None = None) -> CoachChat:
    text = text.strip()
    if not text:
        raise CoachError("질문을 입력해 주세요.")
    if len(text) > 3000:
        raise CoachError("질문이 너무 길어요 (3,000자 이내).")
    if chat_id:
        chat = session.get(CoachChat, chat_id)
        if not chat:
            raise CoachError("대화를 찾을 수 없어요.")
    else:
        now = datetime.now()
        chat = CoachChat(created_at=now, updated_at=now, title=text[:40], messages=[],
                         model=feature_config(session, "chat")[0])
    messages: list[dict] = list(chat.messages or [])
    if sum(1 for m in messages if m["role"] == "user" and isinstance(m["content"], str)) >= MAX_TURNS:
        raise CoachError("대화가 길어졌어요. 새 대화를 시작해 주세요.")

    messages.append({"role": "user", "content": f"{_profile_note(session)}\n{text}"})
    turn_cost = 0.0
    for _ in range(MAX_STEPS):
        response = call(
            session, "chat", client=client, model=chat.model,
            system=SYSTEM, tools=TOOLS, messages=messages,
            cache_control={"type": "ephemeral"},
        )
        turn_cost += cost_of(response.model, response.usage)
        messages.append({"role": "assistant", "content": [b.to_dict() for b in response.content]})
        if response.stop_reason == "pause_turn":
            continue
        uses = [b for b in response.content if b.type == "tool_use"]
        if response.stop_reason != "tool_use" or not uses:
            break
        results = []
        for u in uses:
            content, is_error = _run_tool(session, u.name, dict(u.input or {}))
            results.append({"type": "tool_result", "tool_use_id": u.id, "content": content, "is_error": is_error})
        messages.append({"role": "user", "content": results})
    else:
        # Out of lookup steps: ask for an answer from what has been gathered, with tools off.
        response = call(
            session, "chat", effort="low", model=chat.model, client=client, system=SYSTEM, tools=TOOLS,
            tool_choice={"type": "none"}, messages=messages,
        )
        turn_cost += cost_of(response.model, response.usage)
        messages.append({"role": "assistant", "content": [b.to_dict() for b in response.content]})

    chat.messages = messages
    chat.updated_at = datetime.now()
    chat.cost_usd = round((chat.cost_usd or 0) + turn_cost, 4)
    session.add(chat)
    session.commit()
    session.refresh(chat)
    return chat


TOOL_LABELS = {
    "list_runs": "러닝 목록", "run_detail": "러닝 상세", "weekly_summary": "주간 요약", "monthly_summary": "월별 요약",
    "fitness": "체력 흐름", "wellness": "컨디션", "training_plan": "훈련 계획", "shoes": "신발",
}


def display(chat: CoachChat) -> dict:
    """What the UI shows: user questions and Claude's answers, with the lookups it made in between."""
    items: list[dict] = []
    tools: list[str] = []
    for m in chat.messages or []:
        if m["role"] == "user" and isinstance(m["content"], str):
            q = m["content"].split("\n", 1)[1] if m["content"].startswith("[오늘 ") and "\n" in m["content"] else m["content"]
            items.append({"role": "user", "text": q})
            tools = []
        elif m["role"] == "assistant":
            for b in m["content"]:
                if b.get("type") == "tool_use":
                    tools.append(TOOL_LABELS.get(b.get("name"), b.get("name")))
            text = "".join(b.get("text", "") for b in m["content"] if b.get("type") == "text").strip()
            if text and not any(b.get("type") == "tool_use" for b in m["content"]):
                items.append({"role": "assistant", "text": text, "tools": sorted(set(tools))})
                tools = []
    return {
        "id": chat.id, "title": chat.title, "created_at": chat.created_at, "updated_at": chat.updated_at,
        "cost_usd": chat.cost_usd, "model": chat.model, "items": items,
    }

