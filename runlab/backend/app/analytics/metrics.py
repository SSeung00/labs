"""Per-activity derived metrics, computed from the stored stream.

Bump METRICS_VERSION whenever a formula changes; stale rows are recomputed on startup.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sqlalchemy import text
from sqlmodel import Session, col, delete, or_, select

from app.analytics import physio
from app.analytics.profile import EffectiveProfile, effective_profile
from app.analytics.zones import sample_dt, time_in_zones
from app.ingest.store import load_stream
from app.models import Activity, BestEffort

log = logging.getLogger(__name__)

METRICS_VERSION = 4  # 4: lap speeds backfilled → re-run interval detection

BEST_EFFORT_DISTANCES = [400, 1000, 1609.344, 3000, 5000, 10000, 21097.5, 42195]

# Without HR: session-RPE load scaled so 60 min at RPE 7 ≈ 100 (≈ 1 h at threshold).
SRPE_SCALE = 100 / (60 * 7)
# Without HR or RPE: assume an easy run (IF ≈ 0.75 → 56 per hour).
DURATION_LOAD_PER_HOUR = 56


@dataclass
class ActivityMetrics:
    gap_speed_mps: float | None = None
    trimp: float | None = None
    hr_tss: float | None = None
    efficiency_factor: float | None = None
    decoupling_pct: float | None = None
    zone_seconds: list[float] | None = None
    vdot_est: float | None = None
    best_efforts: dict[float, tuple[float, float]] | None = None  # distance -> (time_s, start_t)


def _grade(df: pd.DataFrame) -> np.ndarray:
    if "alt" not in df or "dist" not in df or df["alt"].isna().all():
        return np.zeros(len(df))
    alt = df["alt"].interpolate(limit_direction="both").rolling(15, center=True, min_periods=1).mean()
    dist = df["dist"].interpolate(limit_direction="both")
    # Grade over a ~30 s window so GPS-altitude jitter doesn't dominate.
    d_alt = alt.diff(30).shift(-15)
    d_dist = dist.diff(30).shift(-15)
    g = (d_alt / d_dist.where(d_dist > 5)).fillna(0).clip(-0.35, 0.35)
    return g.to_numpy()


def best_efforts(df: pd.DataFrame) -> dict[float, tuple[float, float]]:
    """Fastest elapsed time to cover each standard distance anywhere within the run."""
    if "dist" not in df:
        return {}
    d = df[["t", "dist"]].dropna()
    if len(d) < 10:
        return {}
    t = d["t"].to_numpy()
    x = np.maximum.accumulate(d["dist"].to_numpy())
    out: dict[float, tuple[float, float]] = {}
    for D in BEST_EFFORT_DISTANCES:
        if x[-1] - x[0] < D * 0.995:
            continue
        j = np.searchsorted(x, x + D, side="left")
        ok = j < len(x)
        if not ok.any():
            continue
        i_idx = np.nonzero(ok)[0]
        j_idx = j[ok]
        # Interpolate the exact crossing time between samples j-1 and j.
        x0, x1 = x[j_idx - 1], x[j_idx]
        t0, t1 = t[j_idx - 1], t[j_idx]
        target = x[i_idx] + D
        frac = np.where(x1 > x0, (target - x0) / np.maximum(x1 - x0, 1e-9), 0)
        dur = (t0 + frac * (t1 - t0)) - t[i_idx]
        k = int(np.argmin(dur))
        if dur[k] > 0:
            out[D] = (float(dur[k]), float(t[i_idx[k]]))
    return out


def compute(act: Activity, df: pd.DataFrame | None, prof: EffectiveProfile) -> ActivityMetrics:
    m = ActivityMetrics()
    if df is None or df.empty:
        return m

    dt = sample_dt(df).to_numpy()
    speed = df["speed"].to_numpy(dtype=float) if "speed" in df else np.full(len(df), np.nan)
    moving = np.nan_to_num(speed) > 0.5
    moving_s = float(dt[moving].sum()) or float(dt.sum())

    # Grade-adjusted speed: flat-equivalent metabolic speed.
    cost = physio.minetti_cost(_grade(df))
    gap_speed = np.nan_to_num(speed) * cost / physio.FLAT_COST
    if moving.any():
        m.gap_speed_mps = float((gap_speed * dt)[moving].sum() / moving_s)

    if "hr" in df and not df["hr"].isna().all():
        hr = df["hr"].to_numpy(dtype=float)
        hr_valid = ~np.isnan(hr)
        m.trimp = physio.banister_trimp(np.where(hr_valid, hr, prof.rest_hr), dt, prof.rest_hr, prof.max_hr)
        ref = physio.trimp_per_hour_at(prof.lthr, prof.rest_hr, prof.max_hr)
        m.hr_tss = m.trimp / ref * 100 if ref > 0 else None
        m.zone_seconds = time_in_zones(df, prof.zone_bounds)

        mask = moving & hr_valid
        if mask.sum() > 60 and m.gap_speed_mps:
            avg_hr = float((hr * dt)[mask].sum() / dt[mask].sum())
            m.efficiency_factor = (m.gap_speed_mps * 60) / avg_hr  # metres per minute per beat
            if moving_s >= 20 * 60:
                m.vdot_est = physio.vdot_from_hr(m.gap_speed_mps, avg_hr, prof.max_hr)

            # Aerobic decoupling: EF in the first vs second half of moving time.
            if moving_s >= 30 * 60:
                cum = np.cumsum(np.where(mask, dt, 0))
                half = cum[-1] / 2
                first, second = mask & (cum <= half), mask & (cum > half)
                ef = []
                for part in (first, second):
                    w = dt[part]
                    if w.sum() > 0:
                        ef.append((gap_speed[part] * w).sum() / (hr[part] * w).sum())
                if len(ef) == 2 and ef[0] > 0:
                    m.decoupling_pct = float((ef[0] - ef[1]) / ef[0] * 100)

    m.best_efforts = best_efforts(df)
    return m


def apply(session: Session, act: Activity, prof: EffectiveProfile) -> None:
    df = load_stream(act.id) if act.has_stream else None
    m = compute(act, df, prof)
    act.gap_speed_mps = m.gap_speed_mps or act.avg_speed_mps
    act.trimp = m.trimp
    act.hr_tss = m.hr_tss
    act.efficiency_factor = m.efficiency_factor
    act.decoupling_pct = m.decoupling_pct
    act.zone_seconds = m.zone_seconds
    act.vdot_est = m.vdot_est

    hours = (act.moving_time_s or act.duration_s or 0) / 3600
    if act.hr_tss is not None:
        act.load, act.load_source = act.hr_tss, "hr"
    elif act.rpe:
        act.load, act.load_source = act.rpe * hours * 60 * SRPE_SCALE, "rpe"
    else:
        act.load, act.load_source = hours * DURATION_LOAD_PER_HOUR, "duration"

    session.exec(delete(BestEffort).where(BestEffort.activity_id == act.id))
    if "run" in act.sport and "treadmill" not in act.sport:  # treadmill distance isn't trustworthy for PRs
        for dist, (t, start) in (m.best_efforts or {}).items():
            session.add(BestEffort(activity_id=act.id, distance_m=dist, time_s=t, start_offset_s=start))
    act.metrics_version = METRICS_VERSION
    session.add(act)


def fill_lap_speeds(session: Session) -> int:
    """Derive missing lap speeds from distance/time (some watches leave the FIT field invalid)."""
    res = session.execute(
        text(
            "UPDATE lap SET avg_speed_mps = distance_m / duration_s "
            "WHERE avg_speed_mps IS NULL AND distance_m > 0 AND duration_s > 0"
        )
    )
    session.commit()
    return res.rowcount or 0


def needs_recompute(session: Session) -> bool:
    return session.exec(
        select(Activity.id).where(or_(col(Activity.metrics_version).is_(None), Activity.metrics_version < METRICS_VERSION))
    ).first() is not None


def recompute(session: Session, force: bool = False, progress=None) -> int:
    """Recompute metrics for stale (or all, with force) activities. Returns count."""
    prof = effective_profile(session)
    stmt = select(Activity).order_by(col(Activity.start_time))
    if not force:
        stmt = stmt.where(or_(col(Activity.metrics_version).is_(None), Activity.metrics_version < METRICS_VERSION))
    rows = session.exec(stmt).all()
    for i, act in enumerate(rows, 1):
        try:
            apply(session, act, prof)
        except Exception:
            log.exception("metrics failed for activity %s", act.id)
        if i % 25 == 0:
            session.commit()
        if progress:
            progress(i, len(rows))
    session.commit()
    # Types depend on zones/laps and on neighbouring runs (warm-ups), so classify after metrics.
    from app.analytics.run_type import classify_all

    classify_all(session, prof)
    return len(rows)
