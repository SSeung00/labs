from datetime import date, timedelta

import numpy as np
import pandas as pd

from app.analytics import progress as P


def _series(v_now: float, days: int = 300) -> pd.DataFrame:
    start = pd.Timestamp(date.today() - timedelta(days=days - 1))
    t = np.arange(days)
    v = 50 - 12 * np.exp(-t / 150)  # saturating growth toward 50
    v = v - v[-1] + v_now
    return pd.DataFrame({"day": pd.date_range(start, periods=days, freq="D"), "v": v})


def test_forecast_is_anchored_to_current_fitness():
    fit = P.fit_growth(_series(44.0), n_boot=40)
    assert fit["ok"]
    first_future = next(c for c in fit["curve"] if c["future"])
    assert abs(first_future["v"] - 44.0) < 0.5
    assert fit["curve"][-1]["v"] > 44.0  # still rising


def test_goal_already_reached_uses_current_not_curve():
    fit = P.fit_growth(_series(44.0), n_boot=40)
    assert P.goal_eta(fit, 43.0)["already"] is True
    hard = P.goal_eta(fit, 60.0)
    assert hard["already"] is False and hard["eta"] is None
