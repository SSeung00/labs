"""Sequential fitness estimate: every run is evidence that nudges VDOT, weighted by how telling it is.

A one-dimensional Kalman filter over days:
  - between days fitness drifts (random walk), a little faster when you stop running;
  - an all-out race sets the level almost directly (its race-equivalent VDOT, small error);
  - a hard effort in training proves at least that level (one-sided: only pulls up);
  - heart-rate-based estimates (pace ÷ %HRmax) move it gently, after correcting their personal bias,
    which is learned from races (HR estimates usually read a few points high or low per person).

The result is a daily series with an uncertainty band; a good session shows up within days and one
bad day barely moves it.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np
import pandas as pd
from sqlmodel import Session, col, select

from app.analytics import physio
from app.analytics.profile import effective_profile
from app.models import Activity, BestEffort

Q_DAY = 0.03          # fitness drift variance per day (≈ ±1 VDOT a month)
Q_IDLE = 0.08         # per day after 7 days without running
R_RACE = 0.8 ** 2     # all-out race
R_PERF = 1.4 ** 2     # hard effort in training (lower bound)
R_HR = {"workout": 2.2 ** 2, "race": 2.2 ** 2, "long": 2.8 ** 2, "easy": 3.0 ** 2, "recovery": 3.5 ** 2}
ALL_OUT_HR = 0.84     # avg HR / max HR for a race to count as all-out
BIAS_PRIOR = 0.0
BIAS_RATE = 0.2       # how fast the HR bias follows new races (tuned on past races)
GATE_SD = 3.0         # an observation this many SDs off counts as an outlier (trail race, bad data)
HEAT_BASE_C = 15.0    # above this, heat lowers HR-based estimates (HR drifts up)
HEAT_PER_C = 0.002    # fraction of VDOT per °C over HEAT_BASE_C added back to HR-based estimates


@dataclass
class Run:
    day: date
    kind: str
    vdot_hr: float | None
    vdot_perf: float | None
    all_out: bool
    temp_c: float | None = None


def load_runs(session: Session) -> list[Run]:
    prof = effective_profile(session)
    perf: dict[int, float] = {}
    for aid, d, t in session.exec(select(BestEffort.activity_id, BestEffort.distance_m, BestEffort.time_s).where(BestEffort.distance_m >= 3000)):
        perf[aid] = max(perf.get(aid, 0.0), physio.vdot_from_race(d, t))
    rows = session.exec(
        select(Activity.id, Activity.start_time, Activity.run_type, Activity.vdot_est, Activity.avg_hr, Activity.sport,
               Activity.distance_m, Activity.weather)
        .where(col(Activity.sport).contains("run")).order_by(col(Activity.start_time))
    ).all()
    out: list[Run] = []
    for aid, start, kind, vhr, hr, sport, dist, weather in rows:
        if "treadmill" in (sport or ""):
            continue  # footpod speed is unreliable
        vp = perf.get(aid)
        all_out = kind == "race" and bool(hr) and hr / prof.max_hr >= ALL_OUT_HR and (dist or 0) >= 4500
        temp = (weather or {}).get("temp_c") if weather else None
        out.append(Run(start.date(), kind or "easy", vhr, vp, all_out, temp))
    return out


def _update(x: float, p: float, y: float, r: float) -> tuple[float, float]:
    """Kalman update; far-off observations get a much larger error so they can't yank the estimate."""
    if abs(y - x) > GATE_SD * math.sqrt(p + r):
        r *= 9
    k = p / (p + r)
    return x + k * (y - x), (1 - k) * p


def run_filter(runs: list[Run], until: date | None = None, start_v: float | None = None) -> pd.DataFrame:
    """Daily posterior (v, sd) from the first run to `until`; observations on a day update that day."""
    until = until or date.today()
    if not runs:
        return pd.DataFrame(columns=["day", "v", "sd", "bias"])
    by_day: dict[date, list[Run]] = {}
    for r in runs:
        by_day.setdefault(r.day, []).append(r)
    first = runs[0].day
    seed = [r.vdot_perf for r in runs[:10] if r.vdot_perf] + [r.vdot_hr for r in runs[:10] if r.vdot_hr]
    x = start_v or (float(np.median(seed)) if seed else 40.0)
    p = 4.0 ** 2
    bias = BIAS_PRIOR
    last_run = first
    rows = []
    d = first
    while d <= until:
        idle = (d - last_run).days
        p += Q_IDLE if idle > 7 else Q_DAY
        for r in by_day.get(d, []):
            last_run = d
            vhr = r.vdot_hr
            if vhr and r.temp_c is not None and r.temp_c > HEAT_BASE_C:
                vhr *= 1 + HEAT_PER_C * (r.temp_c - HEAT_BASE_C)
            if r.all_out and r.vdot_perf:
                if abs(r.vdot_perf - x) > GATE_SD * math.sqrt(p + R_RACE) + 2:
                    continue  # not a real all-out effort (trail, pacing a friend…): ignore it
                # Learn the HR bias from this race before using it as the level.
                if vhr:
                    bias += BIAS_RATE * ((vhr - r.vdot_perf) - bias)
                x, p = _update(x, p, r.vdot_perf, R_RACE)
                continue
            if r.vdot_perf and r.vdot_perf > x:
                x, p = _update(x, p, r.vdot_perf, R_PERF)
            if vhr:
                x, p = _update(x, p, vhr - bias, R_HR.get(r.kind, R_HR["easy"]))
        rows.append((pd.Timestamp(d), x, math.sqrt(p), bias))
        d += timedelta(days=1)
    return pd.DataFrame(rows, columns=["day", "v", "sd", "bias"])


def sequential_series(session: Session) -> pd.DataFrame:
    return run_filter(load_runs(session))


def backtest(session: Session, legacy: pd.DataFrame) -> dict:
    """For every all-out race: the estimate the day before vs the race's own VDOT, old and new."""
    runs = load_runs(session)
    new = run_filter(runs).set_index("day")
    old = legacy.set_index("day") if len(legacy) else pd.DataFrame(columns=["v"])
    rows = []
    for r in runs:
        if not (r.all_out and r.vdot_perf):
            continue
        prev = pd.Timestamp(r.day - timedelta(days=1))
        if prev not in new.index or prev not in old.index:
            continue
        rows.append({"day": r.day.isoformat(), "actual": round(r.vdot_perf, 1),
                     "new": round(float(new.loc[prev, "v"]), 1), "old": round(float(old.loc[prev, "v"]), 1)})
    if not rows:
        return {"n": 0, "races": []}
    err_new = [abs(x["new"] - x["actual"]) for x in rows]
    err_old = [abs(x["old"] - x["actual"]) for x in rows]
    return {
        "n": len(rows),
        "mae_new": round(float(np.mean(err_new)), 2),
        "mae_old": round(float(np.mean(err_old)), 2),
        # Medians: a few non-all-out "races" (trail, fun runs) dominate the means.
        "median_new": round(float(np.median(err_new)), 2),
        "median_old": round(float(np.median(err_old)), 2),
        "bias_new": round(float(np.mean([x["new"] - x["actual"] for x in rows])), 2),
        "bias_old": round(float(np.mean([x["old"] - x["actual"] for x in rows])), 2),
        "races": rows,
    }
