"""Training-load time series (Banister impulse-response, Coggan naming).

CTL "fitness" = 42-day EWMA of daily load, ATL "fatigue" = 7-day EWMA,
TSB "form" for day d = CTL(d-1) − ATL(d-1), i.e. how fresh you are going into d.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd
from sqlmodel import Session, col, select

from app.models import Activity

CTL_DAYS = 42
ATL_DAYS = 7


def daily_load_frame(session: Session) -> pd.DataFrame:
    rows = session.exec(
        select(Activity.start_time, Activity.load, Activity.distance_m, Activity.sport, Activity.zone_seconds)
        .where(col(Activity.load).is_not(None))
    ).all()
    if not rows:
        return pd.DataFrame(columns=["load", "run_km", "z1", "z2", "z3", "z4", "z5"], dtype=float)
    df = pd.DataFrame(rows, columns=["start", "load", "dist", "sport", "zones"])
    df["day"] = pd.to_datetime(df["start"]).dt.normalize()
    df["run_km"] = np.where(df["sport"].str.contains("run"), df["dist"] / 1000, 0.0)
    # Intensity distribution is about running; walks/strength would swamp Z1.
    is_run = df["sport"].str.contains("run")
    zones = df["zones"].where(is_run).apply(lambda z: z if isinstance(z, list) and len(z) == 5 else [0.0] * 5)
    for i in range(5):
        df[f"z{i + 1}"] = zones.apply(lambda z, i=i: z[i])
    return df.groupby("day")[["load", "run_km", "z1", "z2", "z3", "z4", "z5"]].sum()


def pmc(session: Session, days: int = 365, planned: dict[date, float] | None = None, project_days: int = 0) -> pd.DataFrame:
    """Daily load/CTL/ATL/TSB/ACWR from the first activity (to warm up the EWMA) through today
    (+ `project_days` using `planned` loads), sliced to the last `days` days + projection."""
    daily = daily_load_frame(session)
    today = pd.Timestamp(date.today())
    start = daily.index.min() if len(daily) else today - pd.Timedelta(days=days)
    end = today + pd.Timedelta(days=project_days)
    idx = pd.date_range(start, end, freq="D")
    df = daily.reindex(idx, fill_value=0.0)
    df["planned"] = False
    if planned:
        for d, load in planned.items():
            ts = pd.Timestamp(d)
            if today < ts <= end:
                df.loc[ts, "load"] = load
                df.loc[ts, "planned"] = True

    load = df["load"].to_numpy()
    ctl = np.zeros(len(df))
    atl = np.zeros(len(df))
    c = a = 0.0
    for i, x in enumerate(load):
        c += (x - c) / CTL_DAYS
        a += (x - a) / ATL_DAYS
        ctl[i], atl[i] = c, a
    df["ctl"] = ctl
    df["atl"] = atl
    df["tsb"] = np.concatenate([[0.0], ctl[:-1] - atl[:-1]])
    acute = df["load"].rolling(7, min_periods=1).mean()
    chronic = df["load"].rolling(28, min_periods=7).mean()
    df["acwr"] = (acute / chronic.replace(0, np.nan)).round(3)
    df["future"] = df.index > today

    first = today - pd.Timedelta(days=days - 1)
    return df[df.index >= first]


def weekly(session: Session, weeks: int = 26) -> list[dict]:
    daily = daily_load_frame(session)
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    first = monday - timedelta(weeks=weeks - 1)
    idx = pd.date_range(first, monday + timedelta(days=6), freq="D")
    df = daily.reindex(idx, fill_value=0.0)
    out = []
    for w in range(weeks):
        chunk = df.iloc[w * 7 : (w + 1) * 7]
        loads = chunk["load"].to_numpy()
        sd = loads.std()
        monotony = float(loads.mean() / sd) if sd > 0 else None
        total = float(loads.sum())
        out.append({
            "week": (first + timedelta(weeks=w)).isoformat(),
            "load": round(total, 1),
            "run_km": round(float(chunk["run_km"].sum()), 2),
            "monotony": round(monotony, 2) if monotony else None,
            "strain": round(total * monotony, 0) if monotony else None,
            "zone_seconds": [round(float(chunk[f"z{i}"].sum())) for i in range(1, 6)],
        })
    return out


def today_state(session: Session) -> dict:
    df = pmc(session, days=1)
    if df.empty:
        return {"ctl": 0, "atl": 0, "tsb": 0, "acwr": None}
    r = df.iloc[-1]
    return {
        "ctl": round(float(r["ctl"]), 1),
        "atl": round(float(r["atl"]), 1),
        "tsb": round(float(r["tsb"]), 1),
        "acwr": None if pd.isna(r["acwr"]) else float(r["acwr"]),
    }


def as_records(df: pd.DataFrame) -> list[dict]:
    out = []
    for ts, r in df.iterrows():
        out.append({
            "day": ts.date().isoformat() if isinstance(ts, (pd.Timestamp, datetime)) else str(ts),
            "load": round(float(r["load"]), 1),
            "ctl": round(float(r["ctl"]), 1),
            "atl": round(float(r["atl"]), 1),
            "tsb": round(float(r["tsb"]), 1),
            "acwr": None if pd.isna(r["acwr"]) else float(r["acwr"]),
            "run_km": round(float(r.get("run_km", 0)), 2),
            "future": bool(r["future"]),
            "planned": bool(r["planned"]),
        })
    return out
