"""Skill levels (1.0–6.0, A1…C2): a running estimate per skill from every piece of evidence plus study time.

Each skill is tracked with a small Kalman filter:
- predict: between pieces of evidence the level drifts up with the study time that trains that skill
  (effective hours × personal learning rate ÷ hours one level step takes), and its uncertainty grows;
- update: each piece of evidence (placement test, conversation report, reading/listening quiz, writing
  feedback, book test) pulls the estimate toward it, weighted by how reliable that kind of evidence is.

The personal learning rate starts at 1 and is calibrated from how the evidence actually moved compared
with the study time logged, so the forecast gets better the longer the learner uses the app.

The TOEFL iBT (since January 2026) reports each section on the same 1–6 band scale aligned with
CEFR (6 = C2), so the band estimate is the level rounded to the nearest half band.
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, datetime, timedelta

from sqlmodel import Session, func, select

from app.learn import lexicon
from app.models import SKILLS, Activity, LevelRecord

CORE = ("reading", "listening", "speaking", "writing")

# Effective study hours one level step takes for one skill, by the level it starts from
# (3 = B1 → B2 …). Rough figures for a Korean adult self-studying, a bit above Cambridge's guided
# learning hours per CEFR step; the personal rate corrects them once evidence comes in.
HOURS_PER_STEP = {1: 120, 2: 180, 3: 200, 4: 250, 5: 350}

# How much one minute of each activity trains each skill (vocabulary review helps all four a little).
_LISTEN = {"reading": 0.15, "listening": 1.0, "speaking": 0.3, "writing": 0.05}
_REVIEW = {"reading": 0.3, "listening": 0.25, "speaking": 0.2, "writing": 0.2}
TRANSFER: dict[str, dict[str, float]] = {
    "read": {"reading": 1.0, "listening": 0.15, "speaking": 0.1, "writing": 0.25},
    "listen": _LISTEN,
    "external": _LISTEN,
    "talk": {"reading": 0.05, "listening": 0.5, "speaking": 1.0, "writing": 0.2},
    "write": {"reading": 0.15, "listening": 0.0, "speaking": 0.25, "writing": 1.0},
    "review": _REVIEW,
    "drill": _REVIEW,
}

# Reliability of one piece of evidence, as its standard deviation in levels.
NOISE = {"placement": 0.35, "mock": 0.3, "manual": 0.4, "writing": 0.45, "talk": 0.5, "book": 0.55,
         "reading": 0.6, "listening": 0.6}
DAILY_SD = 0.02  # how far a level may wander per day beyond the study-time drift
SOURCE_LABEL = {"placement": "레벨 진단", "mock": "모의고사", "manual": "직접 입력", "writing": "쓰기 첨삭",
                "talk": "AI 대화 리포트", "book": "교재 문제", "reading": "읽기 퀴즈", "listening": "듣기 퀴즈"}


def hours_per_level(level: float) -> float:
    return HOURS_PER_STEP[min(5, max(1, int(level)))]


def record(session: Session, skill: str, level: float, source: str, note: str | None = None,
           commit: bool = True) -> None:
    if skill not in SKILLS:
        return
    session.add(LevelRecord(created_at=datetime.now(), skill=skill, level=round(max(1.0, min(6.0, level)), 2),
                            source=source, note=note))
    if commit:
        session.commit()


def daily_hours(session: Session, since: date | None = None) -> dict[date, dict[str, float]]:
    """day → effective study hours per skill (minutes weighted by TRANSFER)."""
    q = select(Activity.day, Activity.kind, func.sum(Activity.minutes)).group_by(Activity.day, Activity.kind)
    if since:
        q = q.where(Activity.day >= since)
    out: dict[date, dict[str, float]] = defaultdict(lambda: dict.fromkeys(CORE, 0.0))
    for d, kind, minutes in session.exec(q).all():
        for skill, w in TRANSFER.get(kind, {}).items():
            out[d][skill] += float(minutes or 0) * w / 60
    return out


def _records(session: Session) -> dict[str, list[LevelRecord]]:
    out: dict[str, list[LevelRecord]] = {s: [] for s in CORE}
    for r in session.exec(select(LevelRecord).order_by(LevelRecord.created_at)).all():
        if r.skill in out:
            out[r.skill].append(r)
    return out


def _between(hours: dict[date, dict[str, float]], skill: str, a: date, b: date) -> float:
    return sum(v[skill] for d, v in hours.items() if a < d <= b)


def learning_rate(recs: dict[str, list[LevelRecord]], hours: dict[date, dict[str, float]]) -> dict:
    """Personal rate = observed level gain ÷ gain expected from study time, shrunk toward 1 until there is
    enough evidence (≈ 0.6 level of expected progress across skills gives it full weight)."""
    observed = expected = 0.0
    for skill, rows in recs.items():
        if len(rows) < 2:
            continue
        first, last = rows[0], rows[-1]
        if (last.created_at.date() - first.created_at.date()).days < 14:
            continue
        k = 2 if len(rows) >= 4 else 1  # average the first/last two records to damp noise
        a = sum(r.level for r in rows[:k]) / k
        b = sum(r.level for r in rows[-k:]) / k
        expected += _between(hours, skill, first.created_at.date(), last.created_at.date()) / hours_per_level(a)
        observed += b - a
    if expected < 0.05:
        return {"rate": 1.0, "weight": 0.0, "observed": None, "expected": None}
    raw = observed / expected
    weight = min(1.0, expected / 0.6)
    rate = max(0.4, min(2.5, 1 + weight * 0.7 * (raw - 1)))
    return {"rate": round(rate, 2), "weight": round(weight, 2), "observed": round(observed, 2),
            "expected": round(expected, 2)}


def _filter(rows: list[LevelRecord], hours: dict[date, dict[str, float]], skill: str, rate: float,
            until: date) -> tuple[float, float, list[tuple[date, float, float]]]:
    """Run the filter from the first record to `until` → (level, variance, daily series)."""
    first = rows[0]
    level, var = first.level, NOISE.get(first.source, 0.5) ** 2
    pending = rows[1:]
    series: list[tuple[date, float, float]] = []
    d = first.created_at.date()
    i = 0
    while d <= until:
        if d != first.created_at.date():
            h = hours.get(d, {}).get(skill, 0.0)
            gain = rate * h / hours_per_level(level)
            level = min(6.0, level + gain)
            var += DAILY_SD ** 2 + (0.3 * gain) ** 2
        while i < len(pending) and pending[i].created_at.date() <= d:
            r = pending[i]
            noise = NOISE.get(r.source, 0.5) ** 2
            k = var / (var + noise)
            level += k * (r.level - level)
            var *= 1 - k
            i += 1
        series.append((d, level, var))
        d += timedelta(days=1)
    return level, var, series


def _confidence(sd: float) -> str:
    return "높음" if sd < 0.25 else "보통" if sd < 0.45 else "낮음"


_cache: dict = {}


def estimate(session: Session) -> dict:
    """{skills: {skill: {level, sd, low, high, …}|None}, rate, series: {skill: [(day, level, sd)]}}."""
    key = (
        tuple(session.exec(select(func.max(LevelRecord.id), func.count(LevelRecord.id))).one()),
        tuple(session.exec(select(func.max(Activity.id), func.count(Activity.id))).one()),
        date.today(),
    )
    if _cache.get("key") == key:
        return _cache["value"]
    recs = _records(session)
    hours = daily_hours(session)
    rate = learning_rate(recs, hours)
    today = date.today()
    skills: dict[str, dict | None] = {}
    series: dict[str, list] = {}
    for skill, rows in recs.items():
        if not rows:
            skills[skill] = None
            continue
        level, var, s = _filter(rows, hours, skill, rate["rate"], today)
        sd = math.sqrt(var)
        last = rows[-1]
        recent_h = sum(hours.get(today - timedelta(days=i), {}).get(skill, 0.0) for i in range(14)) / 14
        skills[skill] = {
            "level": round(level, 2), "sd": round(sd, 2),
            "low": round(max(1.0, level - 1.28 * sd), 2), "high": round(min(6.0, level + 1.28 * sd), 2),
            "confidence": _confidence(sd), "evidence": len(rows),
            "last_at": last.created_at.isoformat(timespec="minutes"),
            "last_source": SOURCE_LABEL.get(last.source, last.source),
            "days_since": (today - last.created_at.date()).days,
            "hours_per_day": round(recent_h, 2),
            "monthly_gain": round(rate["rate"] * recent_h * 30 / hours_per_level(level), 2),
        }
        series[skill] = [(d.isoformat(), round(lv, 2), round(math.sqrt(v), 2)) for d, lv, v in s]
    value = {"skills": skills, "rate": rate, "series": series}
    _cache.update(key=key, value=value)
    return value


def current(session: Session) -> dict:
    """{levels: {skill: level|None}, labels, overall, toefl: {section: band}, detail, rate}."""
    est = estimate(session)
    out: dict[str, float | None] = {s: (d["level"] if d else None) for s, d in est["skills"].items()}
    out["vocab"] = lexicon.level_from_vocab(lexicon.known_count(session))
    core = [v for k, v in out.items() if k in CORE and v is not None]
    overall = round(sum(core) / len(core), 2) if core else None
    bands = {k: _band(out[k]) for k in CORE}
    known_bands = [b for b in bands.values() if b is not None]
    return {
        "levels": out,
        "labels": {k: lexicon.cefr_label(v) for k, v in out.items()},
        "overall": overall,
        "overall_label": lexicon.cefr_label(overall),
        "toefl": {**bands, "total": _band(sum(known_bands) / len(known_bands)) if len(known_bands) == 4 else None},
        "detail": est["skills"],
        "rate": est["rate"],
    }


def _band(level: float | None) -> float | None:
    if level is None:
        return None
    return max(1.0, min(6.0, round(level * 2) / 2))


def history(session: Session, days: int = 365) -> list[dict]:
    """The evidence itself (one point per record)."""
    since = datetime.now() - timedelta(days=days)
    rows = session.exec(select(LevelRecord).where(LevelRecord.created_at >= since).order_by(LevelRecord.created_at)).all()
    return [{"at": r.created_at.isoformat(timespec="minutes"), "skill": r.skill, "level": r.level,
             "source": r.source, "source_label": SOURCE_LABEL.get(r.source, r.source), "note": r.note} for r in rows]


def overall_or_default(session: Session, default: float = 3.5) -> float:
    return current(session)["overall"] or default
