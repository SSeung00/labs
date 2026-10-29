"""Effective athlete profile: manual settings win, otherwise estimates from history.

The watch isn't worn overnight for this user, so Garmin's "resting HR" is a daytime
minimum (often 90+ bpm) and is only trusted on days that also have sleep data.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta

import numpy as np
from sqlmodel import Session, col, select

from app.models import Activity, AthleteProfile, DailyWellness

DEFAULT_REST_HR = 50.0
# Upper bounds for Z1..Z4 as a fraction of LTHR (Friel-style, 5 zones).
LTHR_ZONE_FRACTIONS = [0.85, 0.89, 0.94, 1.00]
MAX_ZONE_FRACTIONS = [0.68, 0.78, 0.87, 0.93]
ZONE_NAMES = ["Z1 회복", "Z2 유산소", "Z3 템포", "Z4 역치", "Z5 최대"]


@dataclass
class EffectiveProfile:
    max_hr: float
    rest_hr: float
    lthr: float
    zone_bounds: list[float]
    zone_method: str
    sex: str = "male"
    vdot: float | None = None
    sources: dict[str, str] = field(default_factory=dict)  # field -> manual | estimated | default
    estimates: dict[str, float | None] = field(default_factory=dict)

    def as_dict(self) -> dict:
        return asdict(self)


def latest_profile(session: Session) -> AthleteProfile | None:
    return session.exec(
        select(AthleteProfile).order_by(col(AthleteProfile.effective_from).desc(), col(AthleteProfile.id).desc())
    ).first()


def estimate_max_hr(session: Session) -> float | None:
    vals = [v for v in session.exec(select(Activity.max_hr).where(col(Activity.max_hr).is_not(None))) if v > 120]
    return float(np.percentile(vals, 98)) if len(vals) >= 5 else None


def estimate_rest_hr(session: Session) -> float | None:
    rows = session.exec(
        select(DailyWellness.resting_hr).where(
            col(DailyWellness.resting_hr).is_not(None), col(DailyWellness.sleep_total_s).is_not(None)
        )
    ).all()
    return float(np.median(rows)) if rows else None


def estimate_lthr(session: Session, max_hr: float) -> float | None:
    """~LTHR from hard sustained efforts: 30-min-or-longer runs whose average HR is high.

    Average HR over a 25–75 min race-like effort sits close to LTHR; take the 90th
    percentile of such runs' average HR over the past year.
    """
    since = datetime.combine(date.today() - timedelta(days=365), datetime.min.time())
    rows = session.exec(
        select(Activity.avg_hr, Activity.moving_time_s).where(
            col(Activity.sport).contains("run"),
            Activity.start_time >= since,
            col(Activity.avg_hr).is_not(None),
        )
    ).all()
    hard = [hr for hr, t in rows if t and 25 * 60 <= t <= 80 * 60 and hr >= 0.82 * max_hr]
    if len(hard) < 3:
        return None
    return float(min(np.percentile(hard, 90), 0.95 * max_hr))


def effective_profile(session: Session) -> EffectiveProfile:
    p = latest_profile(session)
    sources: dict[str, str] = {}

    est_max = estimate_max_hr(session)
    est_rest = estimate_rest_hr(session)

    def pick(name: str, manual, est, default):
        if manual:
            sources[name] = "manual"
            return float(manual)
        if est:
            sources[name] = "estimated"
            return float(est)
        sources[name] = "default"
        return float(default)

    max_hr = pick("max_hr", p and p.max_hr, est_max, 190)
    rest_hr = pick("rest_hr", p and p.resting_hr, est_rest, DEFAULT_REST_HR)
    est_lthr = estimate_lthr(session, max_hr)
    lthr = pick("lthr", p and p.lthr, est_lthr, 0.89 * max_hr)

    method = (p.hr_zone_method if p else None) or "lthr"
    if p and p.zone_bounds and len(p.zone_bounds) == 4:
        bounds, method = [float(b) for b in p.zone_bounds], "custom"
    elif method == "max":
        bounds = [round(max_hr * f) for f in MAX_ZONE_FRACTIONS]
    else:
        method = "lthr"
        bounds = [round(lthr * f) for f in LTHR_ZONE_FRACTIONS]

    return EffectiveProfile(
        max_hr=max_hr,
        rest_hr=rest_hr,
        lthr=lthr,
        zone_bounds=bounds,
        zone_method=method,
        sex=(p.sex if p else "male"),
        vdot=(p.vdot if p else None),
        sources=sources,
        estimates={"max_hr": est_max, "rest_hr": est_rest, "lthr": est_lthr},
    )
