"""Findings: the correlation explorer's strongest relationships, written as sentences.

For each candidate cause (check-in metrics, Garmin wellness, form) and run outcome (efficiency at the
same heart rate, RPE, decoupling), with a 0–2 day lag, keep only clear relationships (Spearman p < 0.05,
|ρ| ≥ 0.25, enough days), then compare the outcome on "high" vs "low" days so the sentence carries a
real-world size: "수면 시간 7시간 이상인 날의 다음 날, 같은 심박에서 페이스가 평균 6초/km 빨라요".
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from sqlmodel import Session

from app.analytics import insights as I

MIN_DAYS = 15
MIN_GROUP = 5
MIN_RHO = 0.25
LAG_TEXT = {0: "그날", 1: "다음 날", 2: "이틀 뒤"}
OUTCOMES = {
    "ef": "higher_better",
    "rpe": "lower_better",
    "decoupling": "lower_better",
}
# Causes that describe recovery / readiness (shown on the condition screen).
RECOVERY_KEYS = {"tsb", "atl", "load", "steps", "stress_avg", "body_battery_max", "training_readiness"}
# Natural cut points; anything else splits at the median.
THRESHOLDS = {"j:sleep_hours": 7.0}
# Same-day values that include the run itself: load and fatigue count it, and Garmin's daily
# wellness numbers (steps, stress, Body Battery) are measured through the day, run included.
NO_SAME_DAY = {"load", "atl", "steps", "stress_avg", "body_battery_max", "training_readiness"}


def _nice(v: float) -> float:
    return round(v) if abs(v) >= 10 else round(v, 1)


def adjust_outcome(df: pd.DataFrame, y: str) -> pd.Series:
    """Outcome with the day's run distance and temperature regressed out.

    Longer and hotter runs drift more and feel harder; without this, anything that happens to go
    with long weekend runs or summer looks like a cause.
    """
    covs = [c for c in ("run_km", "temp") if c in df]
    if not covs:
        return df[y]
    m = df[y].notna()
    for c in covs:
        m &= df[c].notna()
    if m.sum() < MIN_DAYS:
        return df[y]
    X = np.column_stack([np.ones(int(m.sum()))] + [df.loc[m, c].to_numpy(float) for c in covs])
    coef, *_ = np.linalg.lstsq(X, df.loc[m, y].to_numpy(float), rcond=None)
    out = df[y].copy()
    out[m] = df.loc[m, y] - X @ coef + df.loc[m, y].mean()
    return out


def _confidence(n: int, p: float) -> str:
    return "높은" if n >= 40 and p < 0.01 else "보통"


def _ref_pace(df: pd.DataFrame) -> float | None:
    s = df.get("pace")
    if s is None:
        return None
    s = s.dropna()
    return float(s.median()) if len(s) else None


def _phrase(label: str, unit: str, thr: float, binary: bool) -> str:
    if binary:
        return f"'{label}'에 체크한 날"
    u = "시간" if unit in ("h", "시간") else unit
    return f"{label} {thr:g}{u} 이상인 날"


def _effect(outcome: str, hi: float, lo: float, ref_pace: float | None) -> tuple[str, bool] | None:
    """(sentence tail, high group is better)."""
    if outcome == "ef":
        if not ref_pace or lo <= 0 or hi <= 0:
            return None
        # Efficiency is speed per heartbeat: at the same HR, pace scales with 1/EF.
        sec = ref_pace * (1 - lo / hi)
        if abs(sec) < 2:
            return None
        return f"같은 심박에서 페이스가 평균 {abs(sec):.0f}초/km {'빨라요' if sec > 0 else '느려요'}", sec > 0
    if outcome == "rpe":
        d = hi - lo
        if abs(d) < 0.3:
            return None
        return f"체감 강도(RPE)가 평균 {abs(d):.1f} {'높아요' if d > 0 else '낮아요'}", d < 0
    d = hi - lo
    if abs(d) < 0.5:
        return None
    return f"후반 심박 상승(디커플링)이 {abs(d):.1f}%p {'커요' if d > 0 else '작아요'}", d < 0


def from_frame(df: pd.DataFrame, catalog: list[dict], limit: int = 8) -> list[dict]:
    ref = _ref_pace(df)
    meta = {m["key"]: m for m in catalog}
    causes = [k for k in meta if (k.startswith("j:") or k in RECOVERY_KEYS) and k in df]
    adj = df.copy()
    for y in OUTCOMES:
        if y in df:
            adj[y] = adjust_outcome(df, y)
    best: dict[str, dict] = {}
    for x in causes:
        xs_all = adj[x]
        binary = set(xs_all.dropna().unique()) <= {0, 1}
        for y in OUTCOMES:
            if y not in adj:
                continue
            for lag in (0, 1, 2):
                if lag == 0 and x in NO_SAME_DAY:
                    continue
                c = I.correlate(adj, x, y, lag)
                if "rho" not in c or c["n"] < MIN_DAYS or c["p"] >= 0.05 or abs(c["rho"]) < MIN_RHO:
                    continue
                xs = xs_all
                ys = adj[y].shift(-lag)
                m = xs.notna() & ys.notna()
                thr = 1.0 if binary else THRESHOLDS.get(x, _nice(float(np.median(xs[m]))))
                hi_mask, lo_mask = m & (xs >= thr), m & (xs < thr)
                if hi_mask.sum() < MIN_GROUP or lo_mask.sum() < MIN_GROUP:
                    continue
                eff = _effect(y, float(ys[hi_mask].mean()), float(ys[lo_mask].mean()), ref)
                if eff is None:
                    continue
                tail, hi_better = eff
                score = abs(c["rho"]) * math.sqrt(c["n"])
                if x in best and best[x]["score"] >= score:
                    continue
                label = meta[x]["label"]
                cause = _phrase(label, meta[x].get("unit", ""), thr, binary)
                text = f"{cause}{'의 ' + LAG_TEXT[lag] if lag else ''}, {tail}"
                best[x] = {
                    "key": f"{x}->{y}",
                    "cause": x,
                    "outcome": y,
                    "lag": lag,
                    "text": text,
                    "good": hi_better,
                    "basis": f"기록 {c['n']}일 기준 · {_confidence(c['n'], c['p'])} 신뢰도",
                    "rho": c["rho"],
                    "n": c["n"],
                    "p": c["p"],
                    "category": "recovery" if (x in RECOVERY_KEYS or x.startswith("j:")) else "growth",
                    "score": score,
                }
    out = sorted(best.values(), key=lambda f: -f["score"])[:limit]
    for f in out:
        f.pop("score")
    return out


def heat_finding(session: Session, df: pd.DataFrame) -> dict | None:
    h = I.heat_effect(session)
    if h.get("n", 0) < 20 or h.get("p", 1) >= 0.05 or not h.get("pct_per_5c"):
        return None
    ref = _ref_pace(df)
    pct = h["pct_per_5c"] / 100
    if not ref or abs(pct) < 0.005:
        return None
    sec = ref * (1 / (1 + pct) - 1)  # pace change at the same HR for +5 °C
    return {
        "key": "heat",
        "cause": "temp",
        "outcome": "ef",
        "lag": 0,
        "text": f"기온이 5°C 오를 때마다 같은 심박에서 페이스가 약 {abs(sec):.0f}초/km {'느려져요' if sec > 0 else '빨라져요'}",
        "good": sec <= 0,
        "basis": f"러닝 {h['n']}회 기준 · {_confidence(h['n'], h['p'])} 신뢰도",
        "rho": None,
        "n": h["n"],
        "p": h["p"],
        "category": "growth",
    }


def compute(session: Session, days: int = 365) -> list[dict]:
    df = I.daily_frame(session, days)
    out = from_frame(df, I.metric_catalog(session))
    heat = heat_finding(session, df)
    return out + ([heat] if heat else [])
