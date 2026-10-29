"""Exercise-physiology formulas. Pure functions, SI units unless noted.

References
- Daniels & Gilbert (1979): oxygen cost of running and %VO2max sustainable for t minutes (VDOT).
- Minetti et al. (2002): energy cost of running on gradients (used for grade-adjusted pace).
- Banister (1991): TRIMP; Coggan-style TSS normalisation to 1 h at threshold.
- Swain et al. (1994): %HRmax ≈ 0.64·%VO2max + 0.37.
"""

from __future__ import annotations

import math

import numpy as np
from scipy.optimize import brentq

# ── Daniels VDOT ──────────────────────────────────────────────────────


def vo2_cost(speed_m_min: float | np.ndarray) -> float | np.ndarray:
    """ml/kg/min required to run at `speed_m_min` (Daniels)."""
    v = speed_m_min
    return -4.60 + 0.182258 * v + 0.000104 * v * v


def pct_vo2max_for_duration(minutes: float) -> float:
    """Fraction of VO2max sustainable for a race lasting `minutes` (Daniels)."""
    t = minutes
    return 0.8 + 0.1894393 * math.exp(-0.012778 * t) + 0.2989558 * math.exp(-0.1932605 * t)


def vdot_from_race(distance_m: float, time_s: float) -> float:
    t = time_s / 60.0
    return float(vo2_cost(distance_m / t) / pct_vo2max_for_duration(t))


def race_time_for_vdot(distance_m: float, vdot: float) -> float:
    """Seconds needed to race `distance_m` at a given VDOT (inverse of vdot_from_race)."""
    f = lambda t_min: vdot_from_race(distance_m, t_min * 60) - vdot
    lo, hi = distance_m / 1000 * 2.0, distance_m / 1000 * 15.0  # 2:00–15:00 /km bracket
    return float(brentq(f, lo, hi) * 60)


def speed_at_vo2(vo2: float) -> float:
    """m/s at which the oxygen cost equals `vo2` (positive root of vo2_cost)."""
    a, b, c = 0.000104, 0.182258, -4.60 - vo2
    v_m_min = (-b + math.sqrt(b * b - 4 * a * c)) / (2 * a)
    return v_m_min / 60.0


# Training intensities as a fraction of VDOT (Daniels' tables, rounded).
PACE_ZONES = {
    "E": (0.62, 0.74),  # easy range
    "M": (0.80, 0.84),
    "T": (0.86, 0.89),
    "I": (0.96, 1.00),
    "R": (1.05, 1.10),
}


def training_paces(vdot: float) -> dict[str, dict[str, float]]:
    """Seconds per km (slow, fast) for each Daniels zone. M uses the predicted marathon pace."""
    out = {}
    for zone, (lo, hi) in PACE_ZONES.items():
        out[zone] = {"slow": 1000 / speed_at_vo2(vdot * lo), "fast": 1000 / speed_at_vo2(vdot * hi)}
    m = race_time_for_vdot(42195, vdot) / 42.195
    out["M"] = {"slow": m + 5, "fast": m - 5}
    return out


def vdot_from_hr(speed_mps: float, avg_hr: float, max_hr: float) -> float | None:
    """VDOT implied by a submaximal run: oxygen cost of the pace ÷ %VO2max implied by %HRmax."""
    if not speed_mps or not avg_hr or not max_hr:
        return None
    pct_hr = avg_hr / max_hr
    pct_vo2 = (pct_hr - 0.37) / 0.64
    if pct_vo2 < 0.55 or pct_vo2 > 1.05:  # too easy to be informative, or HR artefact
        return None
    return float(vo2_cost(speed_mps * 60) / pct_vo2)


# ── Grade-adjusted pace (Minetti) ─────────────────────────────────────


def minetti_cost(grade: np.ndarray) -> np.ndarray:
    """J/kg/m on gradient `grade` (rise/run). 3.6 on the flat."""
    i = np.clip(grade, -0.45, 0.45)
    return 155.4 * i**5 - 30.4 * i**4 - 43.3 * i**3 + 46.3 * i**2 + 19.5 * i + 3.6


FLAT_COST = 3.6

# ── Load ──────────────────────────────────────────────────────────────


def trimp_weight(hrr: np.ndarray, male: bool = True) -> np.ndarray:
    k = 1.92 if male else 1.67
    return hrr * 0.64 * np.exp(k * hrr)


def banister_trimp(hr: np.ndarray, dt_s: np.ndarray, rest_hr: float, max_hr: float) -> float:
    hrr = np.clip((hr - rest_hr) / max(max_hr - rest_hr, 1), 0, 1)
    return float(np.nansum(dt_s / 60.0 * trimp_weight(hrr)))


def trimp_per_hour_at(hr: float, rest_hr: float, max_hr: float) -> float:
    hrr = min(max((hr - rest_hr) / max(max_hr - rest_hr, 1), 0), 1)
    return float(60 * trimp_weight(np.array(hrr)))
