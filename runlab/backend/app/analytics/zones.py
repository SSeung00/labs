"""Time-in-zone helpers. Zone boundaries come from analytics.profile."""

from __future__ import annotations

import numpy as np
import pandas as pd


def sample_dt(stream: pd.DataFrame) -> pd.Series:
    """Seconds each sample represents; gaps over 10 s are pauses and count as 0."""
    dt = stream["t"].diff().fillna(1.0)
    return dt.where(dt <= 10, 0).clip(lower=0)


def time_in_zones(stream: pd.DataFrame | None, bounds: list[float]) -> list[float]:
    """Seconds spent in each of 5 zones (Z1 ≤ b0 < Z2 ≤ b1 …)."""
    if stream is None or "hr" not in stream or stream["hr"].isna().all():
        return [0.0] * 5
    dt = sample_dt(stream).to_numpy()
    hr = stream["hr"].to_numpy()
    valid = ~np.isnan(hr)
    idx = np.digitize(hr, bounds, right=True)
    return [float(dt[(idx == z) & valid].sum()) for z in range(5)]
