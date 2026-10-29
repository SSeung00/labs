"""Plain-language condition check: fitness, fatigue and form as three signals plus a one-line diagnosis.

Same numbers as the PMC (CTL/ATL/TSB/ACWR), read for the athlete instead of shown raw:
  fitness  — CTL trend over four weeks (rising / steady / falling) and how many weeks it has risen
  fatigue  — TSB (low / moderate / high)
  form     — ready to race / good to train / needs rest, also using the daily readiness check-in
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

import pandas as pd
from sqlmodel import Session, col, select

from app.analytics import load as load_mod
from app.analytics import readiness as readiness_mod
from app.models import Activity, GoalRace, Plan, PlannedWorkout

KEY_KINDS = {"tempo", "interval", "mp", "long", "race"}
EASY_TARGET = 0.8

# TSB bands, shared with the chart's background.
BANDS = [
    {"key": "overload", "label": "과부하", "lo": None, "hi": -30},
    {"key": "productive", "label": "훈련 효과 구간", "lo": -30, "hi": -10},
    {"key": "neutral", "label": "유지", "lo": -10, "hi": 5},
    {"key": "fresh", "label": "레이스 적기", "lo": 5, "hi": 25},
    {"key": "rested", "label": "휴식 과다", "lo": 25, "hi": None},
]


def _at(df: pd.DataFrame, day: date, colname: str) -> float | None:
    ts = pd.Timestamp(day)
    if df.empty or ts < df.index[0]:
        return None
    return float(df.loc[:ts].iloc[-1][colname])


def fitness_signal(df: pd.DataFrame, today: date) -> dict:
    ctl = _at(df, today, "ctl") or 0.0
    ctl7 = _at(df, today - timedelta(days=7), "ctl")
    ctl28 = _at(df, today - timedelta(days=28), "ctl")
    d28 = None if ctl28 is None else ctl - ctl28
    state = "flat" if d28 is None or abs(d28) < 2 else "up" if d28 > 0 else "down"
    streak = 0
    for k in range(12):
        a, b = _at(df, today - timedelta(days=7 * k), "ctl"), _at(df, today - timedelta(days=7 * (k + 1)), "ctl")
        if a is None or b is None or a - b < 0.3:
            break
        streak += 1
    return {
        "state": state,
        "label": {"up": "오르는 중", "flat": "유지", "down": "떨어지는 중"}[state],
        "value": round(ctl, 1),
        "delta_7d": None if ctl7 is None else round(ctl - ctl7, 1),
        "from_28d": None if ctl28 is None else round(ctl28, 1),
        "rising_weeks": streak,
    }


def fatigue_signal(df: pd.DataFrame, today: date) -> dict:
    tsb = _at(df, today, "tsb") or 0.0
    atl = _at(df, today, "atl") or 0.0
    atl7 = _at(df, today - timedelta(days=7), "atl")
    state = "low" if tsb > 0 else "mid" if tsb > -20 else "high"
    return {
        "state": state,
        "label": {"low": "낮음", "mid": "보통", "high": "높음"}[state],
        "value": round(atl, 1),
        "tsb": round(tsb, 1),
        "delta_7d": None if atl7 is None else round(atl - atl7, 1),
    }


def ramp_signal(acwr: float | None) -> dict:
    if acwr is None:
        state = "unknown"
    elif acwr < 0.8:
        state = "low"
    elif acwr <= 1.3:
        state = "ok"
    elif acwr <= 1.5:
        state = "fast"
    else:
        state = "risk"
    labels = {"unknown": "데이터 부족", "low": "줄어드는 중", "ok": "적정", "fast": "빠르게 느는 중", "risk": "너무 빠름"}
    return {"state": state, "label": labels[state], "value": None if acwr is None else round(acwr, 2)}


def form_signal(tsb: float, acwr: float | None, ready: dict) -> dict:
    low_ready = ready.get("level") in ("low", "very_low")
    if low_ready or tsb < -30 or (acwr or 0) > 1.5:
        state = "rest"
    elif 5 <= tsb <= 25:
        state = "race"
    else:
        state = "train"
    return {
        "state": state,
        "label": {"rest": "쉬어야 함", "race": "레이스 적기", "train": "훈련하기 좋음"}[state],
        "tsb": round(tsb, 1),
        "readiness": ready.get("score"),
        "has_checkin": ready.get("has_checkin", False),
        "band": next(b["key"] for b in BANDS if (b["lo"] is None or tsb >= b["lo"]) and (b["hi"] is None or tsb < b["hi"])),
    }


def intensity_weeks(session: Session, weeks: int = 12) -> list[dict]:
    out = []
    for w in load_mod.weekly(session, weeks):
        total = sum(w["zone_seconds"])
        out.append({
            "week": w["week"],
            "hours": round(total / 3600, 1),
            "run_km": w["run_km"],
            "easy_pct": round((w["zone_seconds"][0] + w["zone_seconds"][1]) / total * 100) if total else None,
        })
    return out


def _recent_race(session: Session, today: date) -> Activity | None:
    since = datetime.combine(today - timedelta(days=14), datetime.min.time())
    return session.exec(
        select(Activity).where(col(Activity.sport).contains("run"), Activity.run_type == "race", Activity.start_time >= since)
        .order_by(col(Activity.start_time).desc())
    ).first()


def _next_key_workout(session: Session, today: date) -> PlannedWorkout | None:
    return session.exec(
        select(PlannedWorkout).join(Plan, col(Plan.id) == col(PlannedWorkout.plan_id)).where(
            Plan.active.is_(True), PlannedWorkout.day >= today, PlannedWorkout.day <= today + timedelta(days=3),
            col(PlannedWorkout.kind).in_(KEY_KINDS), PlannedWorkout.status == "planned",
        ).order_by(col(PlannedWorkout.day))
    ).first()


def recovery_window(distance_m: float) -> int:
    return 10 if distance_m >= 40000 else 5 if distance_m >= 20000 else 2


def _when(d: date, today: date) -> str:
    return "오늘" if d == today else "내일" if d == today + timedelta(days=1) else "모레" if d == today + timedelta(days=2) else f"{d.month}/{d.day}"


def diagnosis(session: Session, fit: dict, fat: dict, form: dict, ramp: dict, weeks: list[dict], today: date) -> tuple[str, list[str]]:
    parts: list[str] = []
    if fit["state"] == "up":
        streak = f"{fit['rising_weeks']}주째 " if fit["rising_weeks"] >= 2 else ""
        parts.append(f"체력은 {streak}오르는 중이에요 ({fit['from_28d']:.0f}→{fit['value']:.0f}).")
    elif fit["state"] == "down":
        why = " 대회 뒤 회복 기간이라 자연스러워요." if _recent_race(session, today) else ""
        parts.append(f"체력이 조금 떨어지고 있어요 ({fit['from_28d']:.0f}→{fit['value']:.0f}).{why}")
    else:
        parts.append(f"체력은 비슷하게 유지되고 있어요 ({fit['value']:.0f}).")
    parts.append({"low": "피로는 거의 풀렸어요.", "mid": "피로가 조금 쌓였어요.", "high": "피로가 많이 쌓였어요."}[fat["state"]])

    advice: list[str] = []
    nxt = _next_key_workout(session, today)
    race = _recent_race(session, today)
    since_race = (today - race.start_time.date()).days if race else None
    if form["state"] == "rest":
        advice.append("오늘은 쉬거나 아주 가볍게 뛰세요.")
        if nxt and nxt.kind != "race":
            advice.append(f"{_when(nxt.day, today)} '{nxt.title}'은 몸 상태를 보고 미루거나 가볍게 바꾸세요.")
    elif race and since_race is not None and since_race <= recovery_window(race.distance_m):
        advice.append(f"{since_race}일 전 대회의 회복 기간이에요. 쉬운 조깅 위주로 가세요.")
    elif form["state"] == "race":
        upcoming = session.exec(select(GoalRace).where(GoalRace.race_day >= today, GoalRace.race_day <= today + timedelta(days=10))).first()
        advice.append("대회 준비가 잘 됐어요." if upcoming else "몸이 가벼운 상태예요. 강훈련하기 좋아요.")
    elif nxt:
        light = " 전날은 가볍게 뛰세요." if fat["state"] == "high" and nxt.day > today else ""
        advice.append(f"{_when(nxt.day, today)} '{nxt.title}'은 계획대로 하세요.{light}")
    else:
        advice.append("이번 주는 계획대로 가면 돼요.")
    if ramp["state"] == "risk":
        advice.append("최근 부하를 너무 빨리 늘렸어요. 이번 주는 거리를 더 늘리지 마세요.")
    last = weeks[-2] if len(weeks) >= 2 else None
    if last and last["easy_pct"] is not None and last["hours"] >= 2 and last["easy_pct"] < 70:
        advice.append(f"지난주 쉬운 강도 비율이 {last['easy_pct']}%로 낮았어요 (목표 80%).")
    return " ".join(parts), advice


def compute(session: Session, today: date | None = None) -> dict:
    today = today or date.today()
    df = load_mod.pmc(session, days=120)
    ready = readiness_mod.compute(session, today)
    acwr = ready["load"].get("acwr")
    fit = fitness_signal(df, today)
    fat = fatigue_signal(df, today)
    ramp = ramp_signal(acwr)
    form = form_signal(fat["tsb"], acwr, ready)
    weeks = intensity_weeks(session)
    headline, advice = diagnosis(session, fit, fat, form, ramp, weeks, today)
    return {
        "headline": headline,
        "advice": advice,
        "flags": ready.get("flags", []),
        "fitness": fit,
        "fatigue": fat,
        "form": form,
        "ramp": ramp,
        "intensity": weeks,
        "easy_target_pct": round(EASY_TARGET * 100),
        "bands": BANDS,
    }
