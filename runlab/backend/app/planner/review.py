"""Planned workout vs what was actually run.

Targets come from the structure (pace zones at the current VDOT, matching HR zones). When the run
has laps that line up with the structure (a workout sent to the watch), each step is paired with its
lap; otherwise the faster laps are taken as the work reps.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlmodel import Session, col, select

from app.analytics import physio
from app.analytics.profile import effective_profile
from app.models import Activity, Lap, Plan, PlannedWorkout
from app.planner import races as races_mod

# Pace zone → HR zone index range (Z1..Z5 = 0..4).
ZONE_HR = {"E": (0, 1), "M": (2, 2), "RP": (2, 3), "T": (3, 3), "I": (4, 4), "R": (4, 4)}
WORK_ZONES = {"M", "RP", "T", "I", "R"}
TOLERANCE_S = 6  # s/km either side of the band still counts as on target


def _bands(vdot: float, race_pace: float | None) -> dict[str, dict[str, float]]:
    out = physio.training_paces(vdot)
    if race_pace:
        out["RP"] = {"slow": race_pace + 4, "fast": race_pace - 4}
    return out


def _hr_ranges(bounds: list[float], max_hr: float) -> list[tuple[int, int]]:
    edges = [0.0, *bounds, max_hr]
    return [(round(edges[i] + (1 if i else 0)), round(edges[i + 1])) for i in range(5)]


def _flatten(steps: list[dict]) -> list[dict]:
    out: list[dict] = []
    for s in steps:
        if s.get("type") == "repeat":
            for _ in range(s.get("reps", 1)):
                out += _flatten(s.get("steps", []))
        else:
            out.append(s)
    return out


def _is_stride(s: dict) -> bool:
    return s.get("pace") == "R" and (s.get("duration_s") or 99) <= 30


def _main_zone(steps: list[dict]) -> str:
    # Strides are a finishing touch on an easy run, not its main set.
    work = [s for s in _flatten(steps) if s.get("pace") in WORK_ZONES and s.get("type") == "run" and not _is_stride(s)]
    if not work:
        return "E"
    weight: dict[str, float] = {}
    for s in work:
        weight[s["pace"]] = weight.get(s["pace"], 0) + (s.get("distance_m") or s.get("duration_s", 0) * 3.5)
    return max(weight, key=lambda z: weight[z])


def verdict(pace: float | None, band: dict[str, float] | None) -> str | None:
    if pace is None or band is None:
        return None
    if pace < band["fast"] - TOLERANCE_S:
        return "fast"
    if pace > band["slow"] + TOLERANCE_S:
        return "slow"
    return "on"


def _pace(dist_m: float, dur_s: float) -> float | None:
    return dur_s / (dist_m / 1000) if dist_m > 50 and dur_s > 0 else None


def _activity_for(session: Session, w: PlannedWorkout) -> Activity | None:
    day0 = datetime.combine(w.day, datetime.min.time())
    runs = session.exec(
        select(Activity).where(col(Activity.sport).contains("run"), Activity.start_time >= day0, Activity.start_time < day0 + timedelta(days=1))
    ).all()
    return max(runs, key=lambda a: a.distance_m) if runs else None


def review(session: Session, w: PlannedWorkout, today: date | None = None) -> dict:
    today = today or date.today()
    plan = session.get(Plan, w.plan_id) if w.plan_id else None
    race_pace = (plan.params or {}).get("race_pace_s_per_km") if plan else None
    vdot = races_mod.current_vdot(session) or 45
    bands = _bands(vdot, race_pace)
    prof = effective_profile(session)
    hr = _hr_ranges(prof.zone_bounds, prof.max_hr)
    steps = w.structure or []
    zone = _main_zone(steps) if steps else "E"

    def hr_range(z: str) -> list[int]:
        lo, hi = ZONE_HR.get(z, (0, 1))
        return [hr[lo][0], hr[hi][1]]

    used_zones = sorted({s["pace"] for s in _flatten(steps) if s.get("pace")}, key=list(ZONE_HR).index)
    targets = {z: {"pace": bands.get(z), "hr": hr_range(z)} for z in used_zones}
    out: dict = {"main_zone": zone, "targets": targets, "actual": None}

    a = _activity_for(session, w) if w.kind != "rest" else None
    if a is None:
        return out
    moving = a.moving_time_s or a.duration_s
    laps = session.exec(select(Lap).where(Lap.activity_id == a.id).order_by(Lap.idx)).all()
    lap_rows = [{"idx": lp.idx, "km": round(lp.distance_m / 1000, 2), "time_s": round(lp.duration_s),
                 "pace": _pace(lp.distance_m, lp.duration_s), "hr": lp.avg_hr} for lp in laps]

    flat = _flatten(steps)
    reps: list[dict] = []
    paired = len(laps) == len(flat) and len(flat) > 1
    if zone in WORK_ZONES:
        band = bands.get(zone)
        if paired:
            for i, (s, lr) in enumerate(zip(flat, lap_rows, strict=True)):
                lr["step"] = s.get("type")
                lr["zone"] = s.get("pace")
                if s.get("pace") in WORK_ZONES and s.get("type") == "run":
                    b = bands.get(s["pace"])
                    lr["verdict"] = verdict(lr["pace"], b)
                    reps.append({"n": len(reps) + 1, "lap": i, "pace": lr["pace"], "hr": lr["hr"], "zone": s["pace"], "verdict": lr["verdict"]})
        else:
            # Laps faster than easy pace are the work; long auto-laps blur short reps, so this is approximate.
            easy_fast = bands["E"]["fast"]
            for i, lr in enumerate(lap_rows):
                if lr["pace"] and lr["pace"] < easy_fast - 5 and lr["km"] >= 0.3:
                    lr["zone"] = zone
                    lr["verdict"] = verdict(lr["pace"], band)
                    reps.append({"n": len(reps) + 1, "lap": i, "pace": lr["pace"], "hr": lr["hr"], "zone": zone, "verdict": lr["verdict"]})
        work_time = sum(lap_rows[r["lap"]]["time_s"] for r in reps)
        work_dist = sum(lap_rows[r["lap"]]["km"] for r in reps) * 1000
        main_pace = _pace(work_dist, work_time) if reps else None
    else:
        main_pace = _pace(a.distance_m, moving)

    band = bands.get(zone)
    out["actual"] = {
        "activity_id": a.id,
        "km": round(a.distance_m / 1000, 2),
        "target_km": round((w.target_distance_m or 0) / 1000, 1),
        "time_s": round(moving),
        "avg_pace": _pace(a.distance_m, moving),
        "avg_hr": a.avg_hr,
        "main_pace": main_pace,
        "main_verdict": verdict(main_pace, band),
        "main_hr_ok": None if not a.avg_hr or zone in WORK_ZONES else bool(a.avg_hr <= hr_range(zone)[1] + 3),
        "reps": reps,
        "paired": paired,
        "laps": lap_rows,
    }
    return out
