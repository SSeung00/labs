"""Periodized plan generator (base → build → peak → taper).

Paces are stored as zone letters (E/M/T/I/R, plus RP = goal race pace) so the UI
can re-render them from the current VDOT — when fitness improves, paces follow.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, timedelta

from app.analytics import physio

# Intensity factor per zone, for planned-load (TSS-like) estimates.
ZONE_IF = {"E": 0.72, "M": 0.82, "RP": 0.88, "T": 0.9, "I": 0.98, "R": 1.02}
LONG_CAP_KM = {5000: 16, 10000: 20, 21097.5: 24, 42195: 34}
DEFAULT_PEAK_KM = {5000: 45, 10000: 55, 21097.5: 65, 42195: 80}
TAPER_WEEKS = {5000: 1, 10000: 1, 21097.5: 2, 42195: 3}

# Day-of-week layouts (Mon=0). Long run day is substituted in.
LAYOUTS = {
    3: {"q1": 1, "easy": [3]},
    4: {"q1": 1, "q2": 3, "easy": [5]},
    5: {"q1": 1, "q2": 3, "easy": [2, 5]},
    6: {"q1": 1, "q2": 3, "easy": [2, 4, 5]},
    7: {"q1": 1, "q2": 3, "easy": [0, 2, 4, 5]},
}


@dataclass
class PlanParams:
    race_distance_m: float
    race_day: date
    start_day: date
    days_per_week: int = 5
    long_run_dow: int = 6
    current_weekly_km: float = 25
    peak_weekly_km: float | None = None
    vdot: float = 45
    goal_time_s: float | None = None


@dataclass
class Workout:
    day: date
    kind: str
    title: str
    phase: str
    target_distance_m: float
    structure: list[dict] = field(default_factory=list)
    target_tss: float = 0
    note: str | None = None


def _closest_key(d: float, table: dict) -> float:
    return min(table, key=lambda k: abs(k - d))


def race_pace_s_per_km(p: PlanParams) -> float:
    t = p.goal_time_s or physio.race_time_for_vdot(p.race_distance_m, p.vdot)
    return t / (p.race_distance_m / 1000)


def zone_pace(p: PlanParams, zone: str) -> float:
    """Representative s/km for load estimates."""
    if zone == "RP":
        return race_pace_s_per_km(p)
    z = physio.training_paces(p.vdot)[zone]
    return (z["slow"] + z["fast"]) / 2


def estimate_tss(p: PlanParams, steps: list[dict]) -> float:
    total = 0.0
    for s in steps:
        if s["type"] == "repeat":
            total += s["reps"] * estimate_tss(p, s["steps"])
            continue
        zone = s.get("pace", "E")
        dur = s.get("duration_s") or (s.get("distance_m", 0) / 1000 * zone_pace(p, zone))
        total += dur / 3600 * ZONE_IF.get(zone, 0.72) ** 2 * 100
    return round(total, 1)


def structure_distance(p: PlanParams, steps: list[dict]) -> float:
    total = 0.0
    for s in steps:
        if s["type"] == "repeat":
            total += s["reps"] * structure_distance(p, s["steps"])
        elif s.get("distance_m"):
            total += s["distance_m"]
        elif s.get("duration_s"):
            total += s["duration_s"] / zone_pace(p, s.get("pace", "E")) * 1000
    return total


def phase_plan(n_weeks: int, race_m: float) -> list[str]:
    taper = TAPER_WEEKS[_closest_key(race_m, TAPER_WEEKS)]
    taper = min(taper, max(n_weeks - 1, 0))
    rest = n_weeks - taper
    if rest <= 0:
        return ["taper"] * n_weeks
    if rest < 6:
        base, peak = 0, max(1, rest // 3)
    else:
        base = round(rest * 0.4)
        peak = max(2, round(rest * 0.25))
    build = rest - base - peak
    return ["base"] * base + ["build"] * build + ["peak"] * peak + ["taper"] * taper


def weekly_volumes(p: PlanParams, phases: list[str]) -> list[float]:
    race_key = _closest_key(p.race_distance_m, DEFAULT_PEAK_KM)
    peak = p.peak_weekly_km or max(p.current_weekly_km * 1.25, min(DEFAULT_PEAK_KM[race_key], p.current_weekly_km * 1.6))
    vols: list[float] = []
    v = max(p.current_weekly_km, 15)
    taper_scale = {1: [0.55], 2: [0.75, 0.5], 3: [0.8, 0.65, 0.45]}
    n_taper = phases.count("taper")
    taper_i = 0
    for i, ph in enumerate(phases):
        if ph == "taper":
            vols.append(round(peak * taper_scale.get(n_taper, [0.6] * n_taper)[taper_i], 1))
            taper_i += 1
            continue
        # Every 4th week (not in peak) is a cutback; the base level holds through it.
        cut = (i + 1) % 4 == 0 and ph in ("base", "build")
        if ph == "peak":
            v = peak
        elif i > 0 and not cut:
            v = min(peak, v * 1.08)
        vols.append(round(v * (0.8 if cut else 1.0), 1))
    return vols


def _wu(km=2.0):
    return {"type": "warmup", "distance_m": km * 1000, "pace": "E"}


def _cd(km=1.5):
    return {"type": "cooldown", "distance_m": km * 1000, "pace": "E"}


def quality_session(p: PlanParams, phase: str, slot: int, week_i: int, km: float) -> tuple[str, str, list[dict]]:
    race_m = p.race_distance_m
    if phase == "base":
        if slot == 1:
            easy = max(km - 0.5, 4)
            return "easy", "이지 + 스트라이드", [
                {"type": "run", "distance_m": easy * 1000, "pace": "E"},
                {"type": "repeat", "reps": 6, "steps": [{"type": "run", "duration_s": 20, "pace": "R"}, {"type": "recover", "duration_s": 60, "pace": "E"}]},
            ]
        reps = 6 + min(week_i, 4)
        return "interval", "언덕 반복", [_wu(), {"type": "repeat", "reps": reps, "steps": [{"type": "run", "duration_s": 60, "pace": "I", "note": "오르막"}, {"type": "recover", "duration_s": 90, "pace": "E", "note": "내리막 조깅"}]}, _cd()]
    if phase == "taper":
        return "interval", "레이스 페이스 감각", [_wu(), {"type": "repeat", "reps": 4, "steps": [{"type": "run", "distance_m": 1000, "pace": "RP"}, {"type": "recover", "duration_s": 120, "pace": "E"}]}, _cd()]

    long_race = race_m >= 21000
    if slot == 1:  # threshold
        if week_i % 2 == 0:
            n = max(2, min(5, round((km - 3.5) / 1.6)))
            return "tempo", f"크루즈 인터벌 {n}×1.6km", [_wu(), {"type": "repeat", "reps": n, "steps": [{"type": "run", "distance_m": 1600, "pace": "T"}, {"type": "recover", "duration_s": 60, "pace": "E"}]}, _cd()]
        mins = max(15, min(35, round((km - 3.5) * 4.2)))
        return "tempo", f"템포런 {mins}분", [_wu(), {"type": "run", "duration_s": mins * 60, "pace": "T"}, _cd()]
    # slot 2
    if phase == "peak" and long_race:
        rp_km = max(4, min(16 if race_m > 30000 else 10, round(km - 3.5)))
        return "mp", f"레이스 페이스 {rp_km}km", [_wu(), {"type": "run", "distance_m": rp_km * 1000, "pace": "RP"}, _cd()]
    rep_m = 1000 if race_m <= 10000 else 1200
    n = max(4, min(6, round((km - 3.5) / (rep_m / 1000 + 0.4))))
    return "interval", f"VO2max 인터벌 {n}×{rep_m // 100 / 10:g}km", [_wu(), {"type": "repeat", "reps": n, "steps": [{"type": "run", "distance_m": rep_m, "pace": "I"}, {"type": "recover", "distance_m": 400, "pace": "E"}]}, _cd()]


def long_run(p: PlanParams, phase: str, km: float) -> tuple[str, list[dict]]:
    if phase == "build" and km >= 14:
        steady = round(min(5, km * 0.25))
        return f"롱런 {km:g}km (마지막 {steady}km 마라톤 페이스)", [{"type": "run", "distance_m": (km - steady) * 1000, "pace": "E"}, {"type": "run", "distance_m": steady * 1000, "pace": "M"}]
    if phase == "peak" and p.race_distance_m > 30000 and km >= 20:
        mp = round(km * 0.4)
        return f"롱런 {km:g}km (중간 {mp}km 레이스 페이스)", [{"type": "run", "distance_m": 5000, "pace": "E"}, {"type": "run", "distance_m": mp * 1000, "pace": "RP"}, {"type": "run", "distance_m": (km - 5 - mp) * 1000, "pace": "E"}]
    return f"롱런 {km:g}km", [{"type": "run", "distance_m": km * 1000, "pace": "E"}]


def generate(p: PlanParams) -> tuple[list[Workout], list[dict]]:
    """Returns workouts and a per-week summary."""
    first_monday = p.start_day - timedelta(days=p.start_day.weekday())
    race_monday = p.race_day - timedelta(days=p.race_day.weekday())
    n_weeks = (race_monday - first_monday).days // 7 + 1
    if n_weeks < 2:
        raise ValueError("레이스까지 최소 2주가 필요해요.")
    phases = phase_plan(n_weeks, p.race_distance_m)
    vols = weekly_volumes(p, phases)
    long_cap = LONG_CAP_KM[_closest_key(p.race_distance_m, LONG_CAP_KM)]
    days = max(3, min(7, p.days_per_week))
    layout = LAYOUTS[days]
    long_dow = p.long_run_dow

    def remap(dow: int) -> int:
        # If a layout day collides with the long-run day, use the free day after it.
        if dow != long_dow:
            return dow
        return (long_dow + 1) % 7

    workouts: list[Workout] = []
    weeks: list[dict] = []
    for w, (phase, vol) in enumerate(zip(phases, vols, strict=True)):
        monday = first_monday + timedelta(weeks=w)
        is_race_week = w == n_weeks - 1
        week: list[Workout] = []
        long_km = round(min(long_cap, max(6, vol * (0.3 if days <= 4 else 0.27))) * 2) / 2
        q_km = max(5, round(vol * 0.17, 1))
        quality_slots = [("q1", 1)] + ([("q2", 2)] if "q2" in layout and phase != "taper" else [])
        used = 0.0

        for key, slot in quality_slots:
            d = monday + timedelta(days=remap(layout[key]))
            kind, title, steps = quality_session(p, phase, slot, w, q_km)
            dist = structure_distance(p, steps)
            week.append(Workout(d, kind, title, phase, round(dist), steps, estimate_tss(p, steps)))
            used += dist / 1000

        if is_race_week:
            race = Workout(p.race_day, "race", "레이스 🏁", phase, p.race_distance_m,
                           [{"type": "run", "distance_m": p.race_distance_m, "pace": "RP"}])
            race.target_tss = estimate_tss(p, race.structure)
            # Two days out: shakeout with strides.
            shake = Workout(p.race_day - timedelta(days=2), "easy", "가벼운 조깅 + 스트라이드", phase, 5000,
                            [{"type": "run", "distance_m": 4000, "pace": "E"}, {"type": "repeat", "reps": 4, "steps": [{"type": "run", "duration_s": 20, "pace": "R"}, {"type": "recover", "duration_s": 60, "pace": "E"}]}])
            shake.target_tss = estimate_tss(p, shake.structure)
            week = [x for x in week if x.day < p.race_day - timedelta(days=2)]
            week += [shake, race]
        else:
            ld = monday + timedelta(days=long_dow)
            title, steps = long_run(p, phase, long_km)
            week.append(Workout(ld, "long", title, phase, long_km * 1000, steps, estimate_tss(p, steps)))
            used += long_km
            easy_days = [remap(x) for x in layout["easy"]]
            remaining = max(0.0, vol - used)
            per = max(4.0, round(remaining / max(len(easy_days), 1) * 2) / 2) if easy_days else 0
            taken = {x.day.weekday() for x in week}
            for dow in easy_days:
                if dow in taken:
                    continue
                d = monday + timedelta(days=dow)
                steps = [{"type": "run", "distance_m": per * 1000, "pace": "E"}]
                week.append(Workout(d, "easy", f"이지런 {per:g}km", phase, per * 1000, steps, estimate_tss(p, steps)))
                taken.add(dow)

        week = [x for x in week if x.day >= p.start_day]
        week.sort(key=lambda x: x.day)
        workouts += week
        weeks.append({
            "week_start": monday.isoformat(),
            "phase": phase,
            "target_km": vol,
            "planned_km": round(sum(x.target_distance_m for x in week) / 1000, 1),
            "planned_tss": round(sum(x.target_tss for x in week)),
        })
    return workouts, weeks


def default_start(today: date | None = None) -> date:
    today = today or date.today()
    return today + timedelta(days=(7 - today.weekday()) % 7 or 7) if today.weekday() > 2 else today


def weeks_between(a: date, b: date) -> int:
    return math.ceil((b - a).days / 7)
