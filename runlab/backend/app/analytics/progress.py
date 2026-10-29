"""Fitness progression: VDOT over time, critical speed, growth-curve fit, race predictions, PRs."""

from __future__ import annotations

import contextlib
import logging
import warnings
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd
from scipy.optimize import curve_fit
from sqlmodel import Session, col, select

from app.analytics import physio
from app.analytics.profile import latest_profile
from app.models import Activity, BestEffort, GoalRace

log = logging.getLogger(__name__)

RACE_DISTANCES = [
    (5000, "5K"),
    (10000, "10K"),
    (21097.5, "하프"),
    (42195, "풀코스"),
]
PR_LABELS = {400: "400m", 1000: "1K", 1609.344: "1마일", 3000: "3K", 5000: "5K", 10000: "10K", 21097.5: "하프", 42195: "풀코스"}


def _runs(session: Session) -> pd.DataFrame:
    rows = session.exec(
        select(Activity.id, Activity.start_time, Activity.name, Activity.vdot_est, Activity.vo2max, Activity.sport, Activity.distance_m)
        .where(col(Activity.sport).contains("run"))
        .order_by(col(Activity.start_time))
    ).all()
    df = pd.DataFrame(rows, columns=["id", "start", "name", "vdot_hr", "vo2max", "sport", "dist"])
    df["day"] = pd.to_datetime(df["start"]).dt.normalize()
    return df


def performance_vdot_by_activity(session: Session) -> dict[int, float]:
    """Best race-equivalent VDOT from each run's best efforts (≥ 3 km, so sprints don't dominate)."""
    rows = session.exec(select(BestEffort.activity_id, BestEffort.distance_m, BestEffort.time_s).where(BestEffort.distance_m >= 3000)).all()
    out: dict[int, float] = {}
    for aid, d, t in rows:
        v = physio.vdot_from_race(d, t)
        out[aid] = max(out.get(aid, 0), v)
    return out


def vdot_points(session: Session) -> pd.DataFrame:
    df = _runs(session)
    perf = performance_vdot_by_activity(session)
    df["vdot_perf"] = df["id"].map(perf)
    df = df[(df["vdot_hr"].notna()) | (df["vdot_perf"].notna())].copy()
    # Treadmill speed (footpod) is unreliable for VDOT.
    df.loc[df["sport"].str.contains("treadmill"), ["vdot_hr", "vdot_perf"]] = np.nan
    return df


def fitness_series(session: Session) -> pd.DataFrame:
    """Daily fitness VDOT (day, v, sd, bias) from the sequential estimator (see vdot_filter)."""
    from app.analytics.vdot_filter import sequential_series

    return sequential_series(session)


def smooth_series_legacy(points: pd.DataFrame) -> pd.DataFrame:
    """The original estimate, kept for comparison: rolling 28-day upper-median of HR-based estimates,
    lifted to recent performance VDOT. It read ~5 VDOT high against this athlete's races."""
    if points.empty:
        return pd.DataFrame(columns=["day", "v"])
    s = points.set_index("day")["vdot_hr"].dropna()
    s = s.groupby(level=0).max()
    if s.empty:
        return pd.DataFrame(columns=["day", "v"])
    idx = pd.date_range(s.index.min(), pd.Timestamp(date.today()), freq="D")
    daily = s.reindex(idx)
    v = daily.rolling("28D", min_periods=3).quantile(0.6).ffill()
    perf = points.set_index("day")["vdot_perf"].dropna().groupby(level=0).max().reindex(idx)
    perf_recent = perf.rolling("42D", min_periods=1).max()
    v = pd.concat([v, perf_recent], axis=1).max(axis=1).dropna()
    return pd.DataFrame({"day": v.index, "v": v.to_numpy()})


def _model(t, v_inf, v0, tau):
    return v_inf - (v_inf - v0) * np.exp(-t / tau)


def fit_growth(series: pd.DataFrame, horizon_days: int = 365, n_boot: int = 150) -> dict:
    """Saturating-exponential fit + bootstrap band. Falls back to a damped linear trend."""
    if len(series) < 30:
        return {"ok": False, "reason": "데이터가 부족해요 (최소 30일 필요)"}
    t0 = series["day"].iloc[0]
    t = (series["day"] - t0).dt.days.to_numpy(dtype=float)
    y = series["v"].to_numpy(dtype=float)
    # Weekly samples are enough and keep residuals less autocorrelated.
    sel = np.arange(0, len(t), 7)
    t, y = t[sel], y[sel]
    future_t = np.arange(t[-1] - t[-1] % 1, t[-1] + horizon_days + 1, 7.0)
    full_t = np.concatenate([t, future_t[future_t > t[-1]]])

    def fit(tt, yy):
        p0 = [max(yy) + 2, yy[0], 180]
        lo = [max(yy) - 1, 15, 14]
        hi = [max(yy) + 25, 90, 3000]
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return curve_fit(_model, tt, yy, p0=p0, bounds=(lo, hi), maxfev=20000)[0]

    try:
        params = fit(t, y)
        method = "exponential"
    except Exception:
        log.info("exp fit failed; linear fallback")
        params = None
        method = "linear"

    if params is not None:
        pred = _model(full_t, *params)
        resid = y - _model(t, *params)
    else:
        recent = t >= t[-1] - 180
        k, b = np.polyfit(t[recent], y[recent], 1)
        pred = k * full_t + b
        resid = y - (k * t + b)

    # Residual bootstrap → percentile band on the curve.
    rng = np.random.default_rng(7)
    sims = []
    if params is not None:
        for _ in range(n_boot):
            yb = _model(t, *params) + rng.choice(resid, size=len(resid), replace=True)
            with contextlib.suppress(RuntimeError, ValueError):  # a resample that won't converge is just skipped
                sims.append(_model(full_t, *fit(t, yb)))
    # Anchor the forecast at today's actual fitness: the curve explains the long-run shape,
    # but the projection should start from where the athlete is now, not where the fit says.
    actual_now = float(series["v"].iloc[-1])
    last_i = len(t) - 1
    is_future = full_t > t[-1]

    def anchor(curve_vals: np.ndarray) -> np.ndarray:
        out = curve_vals.copy()
        out[is_future] += actual_now - curve_vals[last_i]
        return out

    pred = anchor(pred)
    sims = [anchor(np.asarray(s_)) for s_ in sims]
    band_lo = np.percentile(sims, 10, axis=0) if len(sims) > 20 else pred - resid.std() * 1.28
    band_hi = np.percentile(sims, 90, axis=0) if len(sims) > 20 else pred + resid.std() * 1.28

    curve = [
        {
            "day": (t0 + timedelta(days=float(tt))).date().isoformat(),
            "v": round(float(p), 2),
            "lo": round(float(lo_), 2),
            "hi": round(float(hi_), 2),
            "future": bool(tt > t[-1]),
        }
        for tt, p, lo_, hi_ in zip(full_t, pred, band_lo, band_hi, strict=True)
    ]
    out = {
        "ok": True,
        "method": method,
        "curve": curve,
        "rmse": round(float(np.sqrt(np.mean(resid**2))), 2),
        "sims": sims,
        "current": actual_now,
        "t0": t0,
        "full_t": full_t,
    }
    if params is not None:
        out["params"] = {"v_inf": round(float(params[0]), 2), "v0": round(float(params[1]), 2), "tau_days": round(float(params[2]))}
    return out


def critical_speed(session: Session, days: int = 120) -> dict | None:
    since = datetime.combine(date.today() - timedelta(days=days), datetime.min.time())
    rows = session.exec(
        select(BestEffort.distance_m, BestEffort.time_s)
        .join(Activity, col(Activity.id) == col(BestEffort.activity_id))
        .where(Activity.start_time >= since)
    ).all()
    best: dict[float, float] = {}
    for d, t in rows:
        if 120 <= t <= 1500:  # 2–25 min efforts define CS/D'
            best[d] = min(best.get(d, 1e9), t)
    if len(best) < 3:
        return None
    ds = np.array(sorted(best))
    ts = np.array([best[d] for d in ds])
    cs, dprime = np.polyfit(ts, ds, 1)
    # Best segments from steady training runs all sit at one pace, which yields D' ≈ 0 and a
    # CS equal to that pace. Only trust the model when the efforts show a real anaerobic reserve.
    if cs <= 0 or not 50 <= dprime <= 450:
        return None
    r2 = 1 - np.sum((ds - (cs * ts + dprime)) ** 2) / np.sum((ds - ds.mean()) ** 2)
    return {
        "cs_mps": round(float(cs), 3),
        "d_prime_m": round(float(dprime)),
        "r2": round(float(r2), 3),
        "points": [{"distance_m": float(d), "time_s": float(t)} for d, t in zip(ds, ts, strict=True)],
    }


def current_state(session: Session, points: pd.DataFrame, series: pd.DataFrame) -> dict:
    p = latest_profile(session)
    recent = points[points["day"] >= pd.Timestamp(date.today() - timedelta(days=42))]
    vdot_hr = float(recent["vdot_hr"].dropna().quantile(0.6)) if recent["vdot_hr"].notna().sum() >= 3 else None
    perf90 = points[points["day"] >= pd.Timestamp(date.today() - timedelta(days=90))]["vdot_perf"].dropna()
    vdot_perf = float(perf90.max()) if len(perf90) else None
    smooth_now = float(series["v"].iloc[-1]) if len(series) else None
    sd = float(series["sd"].iloc[-1]) if len(series) and "sd" in series else None
    bias = float(series["bias"].iloc[-1]) if len(series) and "bias" in series else 0.0
    manual = p.vdot if p and p.vdot else None
    vdot = manual or smooth_now or vdot_perf or vdot_hr
    vo2 = points["vo2max"].dropna()
    garmin = float(vo2.iloc[-1]) if len(vo2) else None
    return {
        "vdot": round(vdot, 1) if vdot else None,
        "source": "manual" if manual else "estimated",
        "vdot_sd": round(sd, 1) if sd and not manual else None,
        # HR-based estimates are shown corrected by the bias learned from races.
        "vdot_hr": round(vdot_hr - bias, 1) if vdot_hr else None,
        "hr_bias": round(bias, 1),
        "vdot_perf": round(vdot_perf, 1) if vdot_perf else None,
        "garmin_vo2max": garmin,
        "garmin_gap": round(garmin - vdot, 1) if garmin and vdot else None,
    }


def predictions(session: Session, vdot: float | None, cs: dict | None) -> list[dict]:
    # Riegel from the best recent effort ≥ 5 km.
    since = datetime.combine(date.today() - timedelta(days=90), datetime.min.time())
    rows = session.exec(
        select(BestEffort.distance_m, BestEffort.time_s)
        .join(Activity, col(Activity.id) == col(BestEffort.activity_id))
        .where(Activity.start_time >= since, BestEffort.distance_m >= 5000)
    ).all()
    anchor = max(rows, key=lambda r: physio.vdot_from_race(r[0], r[1]), default=None)
    out = []
    for d, label in RACE_DISTANCES:
        item: dict = {"distance_m": d, "label": label}
        if vdot:
            item["vdot_time_s"] = round(physio.race_time_for_vdot(d, vdot))
        if anchor:
            item["riegel_time_s"] = round(anchor[1] * (d / anchor[0]) ** 1.06)
        if cs and d <= 10000:
            t = (d - cs["d_prime_m"]) / cs["cs_mps"]
            if t > 0:
                item["cs_time_s"] = round(t)
        times = [item[k] for k in ("vdot_time_s", "riegel_time_s", "cs_time_s") if k in item]
        if times:
            item["consensus_s"] = round(float(np.median(times)))
        out.append(item)
    return out


def goal_eta(fit: dict, target_vdot: float) -> dict:
    """When does the fitted curve (and its band) cross target_vdot?"""
    if not fit.get("ok"):
        return {"reachable": False}
    t0, full_t = fit["t0"], fit["full_t"]
    curve = np.array([c["v"] for c in fit["curve"]])
    future = np.array([c["future"] for c in fit["curve"]])

    def first_cross(arr):
        idx = np.nonzero(future & (arr >= target_vdot))[0]
        return (t0 + timedelta(days=float(full_t[idx[0]]))).date().isoformat() if len(idx) else None

    already = bool(fit.get("current") is not None and fit["current"] >= target_vdot)
    sims = fit.get("sims") or []
    early = late = None
    if len(sims) > 20:
        crosses = []
        for s in sims:
            idx = np.nonzero(future & (np.asarray(s) >= target_vdot))[0]
            if len(idx):
                crosses.append(full_t[idx[0]])
        if crosses:
            early = (t0 + timedelta(days=float(np.percentile(crosses, 20)))).date().isoformat()
            if len(crosses) / len(sims) >= 0.6:
                late = (t0 + timedelta(days=float(np.percentile(crosses, 80)))).date().isoformat()
        prob = len(crosses) / len(sims)
    else:
        prob = None
    return {
        "reachable": bool(already or first_cross(curve)),
        "already": bool(already),
        "eta": first_cross(curve),
        "eta_early": early,
        "eta_late": late,
        "probability_1y": round(prob, 2) if prob is not None else None,
        "v_inf": fit.get("params", {}).get("v_inf"),
    }


def next_goal(session: Session) -> GoalRace | None:
    return session.exec(
        select(GoalRace).where(GoalRace.race_day >= date.today()).order_by(col(GoalRace.priority), col(GoalRace.race_day))
    ).first()


def personal_records(session: Session) -> list[dict]:
    rows = session.exec(
        select(BestEffort.distance_m, BestEffort.time_s, Activity.id, Activity.start_time, Activity.name)
        .join(Activity, col(Activity.id) == col(BestEffort.activity_id))
        .order_by(col(Activity.start_time))
    ).all()
    by_d: dict[float, list] = {}
    for d, t, aid, st, name in rows:
        by_d.setdefault(d, []).append((t, aid, st, name))
    out = []
    for d in sorted(by_d):
        best = None
        history = []
        for t, aid, st, name in by_d[d]:
            if best is None or t < best[0]:
                best = (t, aid, st, name)
                history.append({"day": st.date().isoformat(), "time_s": round(t, 1), "activity_id": aid, "name": name})
        out.append({
            "distance_m": d,
            "label": PR_LABELS.get(d, f"{d / 1000:g}K"),
            "best": history[-1] if history else None,
            "history": history,
        })
    return out


# ── Plan scenarios ────────────────────────────────────────────────────

SCENARIO_LEVELS = [(1.0, "플랜 100% 이행"), (0.8, "80% 이행"), (0.6, "60% 이행")]


def ctl_vdot_link(session: Session, series: pd.DataFrame) -> dict:
    """How strongly fitness VDOT tracks CTL in this athlete's own history (lagged)."""
    from app.analytics.load import pmc

    if series.empty:
        return {"slope": 0.15, "lag": 14, "r": None, "fallback": True}
    v = series.set_index("day")["v"]
    ctl = pmc(session, days=len(v) + 60)["ctl"]
    best = None
    for lag in (7, 14, 21):
        df = pd.concat([v, ctl.shift(lag)], axis=1, keys=["v", "ctl"]).dropna()
        df = df[df.index >= df.index.min() + pd.Timedelta(days=60)]  # skip EWMA warm-up
        if len(df) < 60 or df["ctl"].std() == 0:
            continue
        slope = float(np.polyfit(df["ctl"], df["v"], 1)[0])
        r = float(np.corrcoef(df["ctl"], df["v"])[0, 1])
        if best is None or r > best["r"]:
            best = {"slope": slope, "lag": lag, "r": r}
    if not best or best["r"] < 0.2:
        return {"slope": 0.15, "lag": 14, "r": best["r"] if best else None, "fallback": True}
    # Keep the response physiologically sane: 0.1–0.5 VDOT per CTL point.
    best["slope"] = float(np.clip(best["slope"], 0.1, 0.5))
    best["fallback"] = False
    return best


def plan_scenarios(session: Session, current_vdot: float | None, series: pd.DataFrame) -> dict | None:
    """Race-day outcomes if the active plan is followed at different compliance levels."""
    from app.analytics.load import pmc
    from app.planner.service import active_plan, plan_view, planned_loads

    plan = active_plan(session)
    if not plan or not current_vdot:
        return None
    today = date.today()
    race_day = plan.end_day
    if race_day <= today:
        return None
    horizon = (race_day - today).days
    link = ctl_vdot_link(session, series)
    lag = link["lag"]
    base = planned_loads(session, today + timedelta(days=1), race_day)
    view = plan_view(session, plan)
    actual = view["compliance"]
    levels = list(SCENARIO_LEVELS)
    if actual is not None and view["due"] >= 5 and all(abs(actual - c) > 0.05 for c, _ in levels):
        levels.append((round(actual, 2), f"지금까지 이행률 {actual:.0%} 유지"))
    levels.sort(key=lambda x: -x[0])

    from app.planner.service import load_calibration

    hist_ctl = pmc(session, days=400)["ctl"]
    hist_max = float(hist_ctl.max()) if len(hist_ctl) else 0.0
    max_gain_per_week = 0.25  # ≈ +1 VDOT/month: an optimistic ceiling for trained adults

    def vdot_gain(ctl_from: float, ctl_to: float, weeks: float) -> float:
        # Full credit inside the CTL range this athlete has actually lived in; beyond it,
        # extrapolation is discounted (diminishing returns, and no data to back it).
        def eff(x: float) -> float:
            return x if x <= hist_max else hist_max + 0.4 * (x - hist_max)

        g = link["slope"] * (eff(ctl_to) - eff(ctl_from))
        cap = max_gain_per_week * max(weeks, 1.0)
        return float(cap * np.tanh(g / cap))  # soft ceiling: big gains flatten, small ones pass through

    race_m = (plan.params or {}).get("race_distance_m")
    goal_s = (plan.params or {}).get("goal_time_s")
    ctl_now = float(pmc(session, days=1)["ctl"].iloc[-1])
    out = []
    for c, label in levels:
        df = pmc(session, days=lag + 1, planned={d: v * c for d, v in base.items()}, project_days=horizon)
        ctl = df["ctl"]
        # VDOT follows CTL `lag` days later; anchor at today's fitness.
        points = []
        for ts in pd.date_range(pd.Timestamp(today), pd.Timestamp(race_day), freq="7D").append(pd.DatetimeIndex([pd.Timestamp(race_day)])):
            src = ts - pd.Timedelta(days=lag)
            ctl_src = float(ctl.get(src, ctl_now))
            ctl_ref = float(ctl.get(pd.Timestamp(today) - pd.Timedelta(days=lag), ctl_now))
            weeks = max((ts - pd.Timestamp(today)).days / 7, 0.0)
            points.append({"day": ts.date().isoformat(), "v": round(current_vdot + vdot_gain(ctl_ref, ctl_src, weeks), 2)})
        race_v = points[-1]["v"]
        rd = df.loc[pd.Timestamp(race_day)]
        item = {
            "compliance": c,
            "label": label,
            "points": points,
            "race_day_vdot": race_v,
            "race_day_ctl": round(float(rd["ctl"]), 1),
            "race_day_tsb": round(float(rd["tsb"]), 1),
            "peak_ctl": round(float(ctl[ctl.index > pd.Timestamp(today)].max()), 1),
        }
        if race_m:
            item["predicted_time_s"] = round(physio.race_time_for_vdot(race_m, race_v))
            if goal_s:
                item["vs_goal_s"] = round(item["predicted_time_s"] - goal_s)
        out.append(item)
    return {
        "plan_name": plan.name,
        "race_day": race_day.isoformat(),
        "race_distance_m": race_m,
        "goal_time_s": goal_s,
        "actual_compliance": actual,
        "link": {**link, "hist_max_ctl": round(hist_max, 1), "load_calibration": round(load_calibration(session), 2), "max_gain_per_week": max_gain_per_week},
        "scenarios": out,
    }
