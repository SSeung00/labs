"""Training-type classification: race · workout(포인트) · easy(조깅) · recovery · long.

Order of trust: manual > import (the user's own spreadsheet) > title keywords > physiology.
Each auto decision carries a confidence and a short Korean reason; low-confidence ones
are surfaced in the UI for the user to confirm.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import timedelta

import numpy as np
from sqlmodel import Session, col, select

from app.analytics.profile import EffectiveProfile, effective_profile
from app.models import Activity, Lap

TYPES = ("race", "workout", "easy", "recovery", "long")
REVIEW_BELOW = 0.7

RE_WUCD = re.compile(r"^(wu|cd)\b|warm[\s-]?up|cool[\s-]?down|워밍업|쿨다운|웜업", re.IGNORECASE)
RE_RACE = re.compile(r"marathon|마라톤|\brace\b|레이스|대회|hyrox|\bhalf\b|하프|\bfull\b|풀코스|night run|trail run \[", re.IGNORECASE)
RE_RACE_10K = re.compile(r"\b10\s?k(m)?\b", re.IGNORECASE)
RE_NOT_RACE = re.compile(r"tempo|템포|\btt\b|time trial|interval|인터벌", re.IGNORECASE)
RE_LONG = re.compile(r"\blsd\b|\blr\b|long\s?run|longrun|롱런|장거리", re.IGNORECASE)
RE_RECOVERY = re.compile(r"recov|회복|리커버리|shake\s?out|sakeout", re.IGNORECASE)
RE_WORKOUT = re.compile(
    r"tempo|템포|interval|인터벌|\btt\b|time trial|fartlek|파틀렉|uphill|hill|언덕|\blt\b|threshold|역치|"
    r"build[\s-]?up|빌드업|\d\s?x\s?\d|x\s?\d+\s*(set|회)?|cruise|크루즈|vo2|repeat|반복",
    re.IGNORECASE,
)
RE_MODERATE = re.compile(r"\baero(bic)?\b|에어로빅|유산소|steady|스테디", re.IGNORECASE)
RE_EASY = re.compile(r"\beasy\b|이지|jog|조깅|\bslow\b", re.IGNORECASE)
GENERIC = re.compile(r"^(running|러닝|트레드밀 러닝|treadmill running|trail running|indoor running|실내 러닝|run)$", re.IGNORECASE)


@dataclass
class Decision:
    run_type: str
    confidence: float
    reason: str
    wucd: bool = False


def is_generic(name: str | None) -> bool:
    return not name or bool(GENERIC.match(name.strip()))


def from_title(name: str | None) -> Decision | None:
    if is_generic(name):
        return None
    n = name.strip()
    if RE_WUCD.search(n):
        return Decision("easy", 0.6, "워밍업/쿨다운", wucd=True)
    if (RE_RACE.search(n) or RE_RACE_10K.search(n)) and not RE_NOT_RACE.search(n):
        return Decision("race", 0.9, f"제목 '{n}'")
    if RE_LONG.search(n):
        return Decision("long", 0.9, f"제목 '{n}'")
    if RE_RECOVERY.search(n):
        return Decision("recovery", 0.9, f"제목 '{n}'")
    if RE_WORKOUT.search(n):
        return Decision("workout", 0.85, f"제목 '{n}'")
    if RE_MODERATE.search(n):
        return Decision("workout", 0.55, f"제목 '{n}' — 중강도라 조깅과 애매")
    if RE_EASY.search(n):
        return Decision("easy", 0.9, f"제목 '{n}'")
    return None


def from_physiology(a: Activity, laps: list[Lap], prof: EffectiveProfile) -> Decision:
    km = (a.distance_m or 0) / 1000
    mins = (a.moving_time_s or a.duration_s or 0) / 60
    zones = a.zone_seconds or []
    total = sum(zones) or 0
    hard = (zones[3] + zones[4]) / total if total else 0.0
    rel_hr = (a.avg_hr or 0) / prof.lthr if prof.lthr else 0

    # Interval signature: lap speeds alternate strongly.
    speeds = np.array([lp.avg_speed_mps for lp in laps if lp.avg_speed_mps and lp.distance_m > 150])
    interval = len(speeds) >= 4 and speeds.std() / speeds.mean() > 0.12 and speeds.max() > 1.15 * np.median(speeds)

    if km >= 18 or mins >= 100:
        conf = 0.9 if km >= 21 or mins >= 120 else 0.75
        return Decision("long", conf, f"{km:.1f}km · {mins:.0f}분")
    if interval:
        return Decision("workout", 0.8, "랩 속도 변화가 큼 (인터벌 패턴)")
    if hard >= 0.35 or (rel_hr >= 0.93 and mins >= 20):
        return Decision("workout", 0.8 if hard >= 0.45 else 0.7, f"고강도(Z4+) {hard:.0%} · 평균 심박 LTHR의 {rel_hr:.0%}")
    if hard >= 0.2:
        return Decision("workout", 0.5, f"고강도(Z4+) {hard:.0%} — 템포인지 빠른 조깅인지 애매")
    if km >= 15:
        return Decision("long", 0.55, f"{km:.1f}km — 장거리 기준(18km)에 조금 못 미침")
    if a.avg_hr and rel_hr <= 0.78 and mins <= 55 and hard < 0.05:
        return Decision("recovery", 0.75 if rel_hr <= 0.74 else 0.6, f"평균 심박 LTHR의 {rel_hr:.0%} · {mins:.0f}분")
    if not a.avg_hr:
        return Decision("easy", 0.5, "심박 기록 없음")
    conf = 0.8 if rel_hr <= 0.86 and hard < 0.1 else 0.6
    return Decision("easy", conf, f"평균 심박 LTHR의 {rel_hr:.0%} · 고강도 {hard:.0%}")


def classify(a: Activity, laps: list[Lap], prof: EffectiveProfile) -> Decision:
    t = from_title(a.name)
    if t and not t.wucd and t.confidence >= 0.85:
        return t
    p = from_physiology(a, laps, prof)
    if t and t.wucd:
        return t
    if t:  # weak title hint (e.g. "Aerobic") — agree → boost, disagree → keep title, low confidence
        if t.run_type == p.run_type:
            return Decision(t.run_type, 0.8, f"{t.reason} · {p.reason}")
        return t
    # Generic name: an all-out effort at a standard race distance might be a race.
    km = (a.distance_m or 0) / 1000
    rel_hr = (a.avg_hr or 0) / prof.lthr if prof.lthr else 0
    if rel_hr >= 0.96 and any(abs(km - d) / d < 0.04 for d in (5, 10, 21.0975, 42.195)):
        return Decision("race", 0.5, f"표준 거리({km:.1f}km)를 최대 강도로 — 레이스였나요?")
    return p


def classify_all(session: Session, prof: EffectiveProfile | None = None) -> int:
    """(Re)classify every run whose type isn't user-set or imported. Returns count changed."""
    prof = prof or effective_profile(session)
    runs = session.exec(select(Activity).where(col(Activity.sport).contains("run")).order_by(col(Activity.start_time))).all()
    lap_rows = session.exec(select(Lap)).all()
    laps_by: dict[int, list[Lap]] = {}
    for lp in lap_rows:
        laps_by.setdefault(lp.activity_id, []).append(lp)

    decisions: dict[int, Decision] = {}
    for a in runs:
        if a.run_type_source in ("manual", "import"):
            continue
        decisions[a.id] = classify(a, laps_by.get(a.id, []), prof)

    # Warm-ups / cool-downs inherit the main session of that day (within 3 h). A short run
    # with a generic name right next to a longer one is almost always a warm-up too.
    by_id = {a.id: a for a in runs}
    for aid, d in decisions.items():
        a = by_id[aid]
        if not d.wucd and is_generic(a.name) and (a.distance_m or 0) < 3000:
            near = any(
                b.id != aid and abs(b.start_time - a.start_time) <= timedelta(hours=3) and b.distance_m > 2 * (a.distance_m or 0)
                for b in runs
            )
            if near:
                d.wucd = True
        if not d.wucd:
            continue
        mates = [
            b for b in runs
            if b.id != aid and abs(b.start_time - a.start_time) <= timedelta(hours=3) and b.distance_m > a.distance_m
        ]
        if mates:
            main = max(mates, key=lambda b: b.distance_m)
            main_type = main.run_type if main.id not in decisions else decisions[main.id].run_type
            if main_type in ("race", "workout"):
                decisions[aid] = Decision(main_type, 0.8, f"워밍업/쿨다운 → 같은 세션 '{main.name or main_type}'")
                continue
        decisions[aid] = Decision("easy", 0.7, "워밍업/쿨다운")

    changed = 0
    for aid, d in decisions.items():
        a = by_id[aid]
        if (a.run_type, a.run_type_reason) != (d.run_type, d.reason):
            changed += 1
        a.run_type, a.run_type_confidence, a.run_type_reason, a.run_type_source = d.run_type, round(d.confidence, 2), d.reason, "auto"
        session.add(a)
    session.commit()
    return changed
