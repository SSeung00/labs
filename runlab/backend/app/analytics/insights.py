"""Daily metric frame + correlation explorer (Spearman, with day lags).

Everything is aligned per calendar day so check-in values, wellness, training load
and run outcomes can be compared: "does X today relate to Y `lag` days later?"
"""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd
from scipy import stats
from sqlmodel import Session, col, select

from app.analytics.load import pmc
from app.models import Activity, CustomMetricDef, CustomMetricValue, DailyWellness

BUILTIN: list[dict] = [
    # group, key, label, unit, polarity
    {"group": "러닝", "key": "run_km", "label": "러닝 거리", "unit": "km", "polarity": "neutral"},
    {"group": "러닝", "key": "ef", "label": "유산소 효율 (EF)", "unit": "", "polarity": "higher_better"},
    {"group": "러닝", "key": "pace", "label": "평균 페이스 (GAP)", "unit": "s/km", "polarity": "lower_better"},
    {"group": "러닝", "key": "run_hr", "label": "평균 심박", "unit": "bpm", "polarity": "neutral"},
    {"group": "러닝", "key": "rpe", "label": "RPE", "unit": "", "polarity": "lower_better"},
    {"group": "러닝", "key": "decoupling", "label": "디커플링", "unit": "%", "polarity": "lower_better"},
    {"group": "러닝", "key": "vdot_est", "label": "VDOT (심박 기반)", "unit": "", "polarity": "higher_better"},
    {"group": "러닝", "key": "temp", "label": "기온 (러닝 시)", "unit": "°C", "polarity": "neutral"},
    {"group": "훈련 부하", "key": "load", "label": "일일 부하", "unit": "", "polarity": "neutral"},
    {"group": "훈련 부하", "key": "ctl", "label": "체력 CTL", "unit": "", "polarity": "higher_better"},
    {"group": "훈련 부하", "key": "atl", "label": "피로 ATL", "unit": "", "polarity": "neutral"},
    {"group": "훈련 부하", "key": "tsb", "label": "폼 TSB", "unit": "", "polarity": "neutral"},
    {"group": "가민", "key": "steps", "label": "걸음 수", "unit": "", "polarity": "neutral"},
    {"group": "가민", "key": "stress_avg", "label": "스트레스 (가민)", "unit": "", "polarity": "lower_better"},
    {"group": "가민", "key": "body_battery_max", "label": "Body Battery 최고", "unit": "", "polarity": "higher_better"},
    {"group": "가민", "key": "training_readiness", "label": "훈련 준비도 (가민)", "unit": "", "polarity": "higher_better"},
]


def metric_catalog(session: Session) -> list[dict]:
    custom = session.exec(
        select(CustomMetricDef).where(CustomMetricDef.archived.is_(False), col(CustomMetricDef.kind).in_(["number", "scale", "bool"]))
        .order_by(col(CustomMetricDef.sort_order))
    ).all()
    return [
        {"group": "일지", "key": f"j:{d.key}", "label": d.label, "unit": d.unit or "", "polarity": d.polarity or "neutral"}
        for d in custom
    ] + BUILTIN


def daily_frame(session: Session, days: int = 365) -> pd.DataFrame:
    start = date.today() - timedelta(days=days)
    idx = pd.date_range(start, date.today(), freq="D")
    df = pd.DataFrame(index=idx)

    # Journal (EAV → wide)
    vals = session.exec(select(CustomMetricValue).where(CustomMetricValue.day >= start, col(CustomMetricValue.value_num).is_not(None))).all()
    if vals:
        j = pd.DataFrame([(pd.Timestamp(v.day), f"j:{v.metric_key}", v.value_num) for v in vals], columns=["day", "key", "v"])
        df = df.join(j.pivot_table(index="day", columns="key", values="v", aggfunc="mean"))

    # Wellness
    w = session.exec(select(DailyWellness).where(DailyWellness.day >= start)).all()
    if w:
        wd = pd.DataFrame([r.model_dump() for r in w])
        wd["day"] = pd.to_datetime(wd["day"])
        df = df.join(wd.set_index("day")[["steps", "stress_avg", "body_battery_max", "training_readiness"]])

    # Load
    p = pmc(session, days=days + 1)
    df = df.join(p[["load", "ctl", "atl", "tsb"]])

    # Runs (duration-weighted per day)
    runs = session.exec(
        select(Activity).where(col(Activity.sport).contains("run"), Activity.start_time >= pd.Timestamp(start).to_pydatetime())
    ).all()
    if runs:
        rd = pd.DataFrame([
            {
                "day": pd.Timestamp(a.start_time.date()),
                "km": a.distance_m / 1000,
                "t": a.moving_time_s or a.duration_s,
                "ef": a.efficiency_factor,
                "gap": a.gap_speed_mps,
                "hr": a.avg_hr,
                "rpe": a.rpe,
                "dec": a.decoupling_pct,
                "vdot": a.vdot_est,
                "temp": (a.weather or {}).get("temp_c") if a.weather else None,
            }
            for a in runs
        ])

        def wavg(g: pd.DataFrame, c: str):
            m = g[c].notna()
            return np.average(g.loc[m, c], weights=g.loc[m, "t"]) if m.any() and g.loc[m, "t"].sum() > 0 else np.nan

        agg = rd.groupby("day").apply(
            lambda g: pd.Series({
                "run_km": g["km"].sum(),
                "ef": wavg(g, "ef"),
                "pace": 1000 / wavg(g, "gap") if wavg(g, "gap") == wavg(g, "gap") and wavg(g, "gap") > 0 else np.nan,
                "run_hr": wavg(g, "hr"),
                "rpe": g["rpe"].max(),
                "decoupling": wavg(g, "dec"),
                "vdot_est": g["vdot"].max(),
                "temp": wavg(g, "temp"),
            }),
            include_groups=False,
        )
        df = df.join(agg)
    return df


def correlate(df: pd.DataFrame, x: str, y: str, lag: int = 0) -> dict:
    if x not in df or y not in df:
        return {"n": 0, "pairs": []}
    xs = df[x]
    ys = df[y].shift(-lag)  # x on day d vs y on day d+lag
    m = xs.notna() & ys.notna()
    pairs = [{"day": d.date().isoformat(), "x": round(float(a), 3), "y": round(float(b), 3)} for d, a, b in zip(df.index[m], xs[m], ys[m], strict=True)]
    n = len(pairs)
    out: dict = {"n": n, "pairs": pairs, "lag": lag}
    if n >= 8 and xs[m].nunique() > 1 and ys[m].nunique() > 1:
        rho, p = stats.spearmanr(xs[m], ys[m])
        slope, intercept, r, _, _ = stats.linregress(xs[m], ys[m])
        out.update({"rho": round(float(rho), 3), "p": float(p), "slope": float(slope), "intercept": float(intercept), "r2": round(float(r * r), 3)})
    return out


def drivers(df: pd.DataFrame, target: str, catalog: list[dict], max_lag: int = 2) -> list[dict]:
    """Rank every metric by its strongest lagged Spearman correlation with `target`."""
    out = []
    run_keys = {m["key"] for m in catalog if m["group"] == "러닝" and m["key"] not in ("temp", "rpe")}
    for m in catalog:
        k = m["key"]
        if k == target or k not in df:
            continue
        best = None
        for lag in range(max_lag + 1):
            # Same-day metrics of the same run are mechanically linked (EF is built from pace and HR).
            if lag == 0 and k in run_keys and target in run_keys:
                continue
            c = correlate(df, k, target, lag)
            if "rho" in c and (best is None or abs(c["rho"]) > abs(best["rho"])):
                best = {"key": k, "label": m["label"], "group": m["group"], "rho": c["rho"], "p": c["p"], "n": c["n"], "lag": lag}
        if best:
            out.append(best)
    return sorted(out, key=lambda r: -abs(r["rho"]))


def heat_effect(session: Session) -> dict:
    """How temperature relates to efficiency: EF by 5 °C bins + linear slope."""
    runs = session.exec(
        select(Activity.efficiency_factor, Activity.weather).where(col(Activity.sport).contains("run"), col(Activity.efficiency_factor).is_not(None))
    ).all()
    pts = [(w.get("temp_c"), ef) for ef, w in runs if w and w.get("temp_c") is not None]
    if len(pts) < 10:
        return {"n": len(pts)}
    t = np.array([p[0] for p in pts])
    e = np.array([p[1] for p in pts])
    slope, intercept, r, p, _ = stats.linregress(t, e)
    bins = []
    for lo in range(int(np.floor(t.min() / 5) * 5), int(np.ceil(t.max())) + 1, 5):
        m = (t >= lo) & (t < lo + 5)
        if m.sum() >= 3:
            bins.append({"lo": lo, "hi": lo + 5, "ef": round(float(np.median(e[m])), 3), "n": int(m.sum())})
    ref = intercept + slope * 12  # efficiency at 12 °C as reference
    return {
        "n": len(pts),
        "slope_per_c": float(slope),
        "pct_per_5c": round(float(slope * 5 / ref * 100), 2) if ref else None,
        "r2": round(float(r * r), 3),
        "p": float(p),
        "bins": bins,
        "points": [{"temp": round(float(a), 1), "ef": round(float(b), 3)} for a, b in pts],
    }
