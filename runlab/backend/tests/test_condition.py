from datetime import date, timedelta

import pandas as pd
from fastapi.testclient import TestClient

from app.analytics import condition
from app.main import app


def _frame(ctl: list[float], atl: list[float], end: date) -> pd.DataFrame:
    idx = pd.date_range(end - timedelta(days=len(ctl) - 1), end, freq="D")
    tsb = [0.0] + [c - a for c, a in zip(ctl[:-1], atl[:-1], strict=True)]
    return pd.DataFrame({"ctl": ctl, "atl": atl, "tsb": tsb}, index=idx)


def test_fitness_rising_counts_weeks():
    today = date(2026, 10, 29)
    ctl = [20 + i * 0.25 for i in range(60)]  # +1.75 a week
    sig = condition.fitness_signal(_frame(ctl, ctl, today), today)
    assert sig["state"] == "up" and sig["rising_weeks"] >= 6
    assert sig["from_28d"] < sig["value"]


def test_fitness_flat_and_down():
    today = date(2026, 10, 29)
    flat = condition.fitness_signal(_frame([30.0] * 60, [30.0] * 60, today), today)
    assert flat["state"] == "flat" and flat["rising_weeks"] == 0
    down = condition.fitness_signal(_frame([40 - i * 0.2 for i in range(60)], [30.0] * 60, today), today)
    assert down["state"] == "down"


def test_fatigue_and_form_bands():
    today = date(2026, 10, 29)
    tired = condition.fatigue_signal(_frame([30.0] * 30, [55.0] * 30, today), today)
    assert tired["state"] == "high" and tired["tsb"] == -25
    fresh = condition.fatigue_signal(_frame([30.0] * 30, [20.0] * 30, today), today)
    assert fresh["state"] == "low"

    ok = {"level": "ok", "score": 60}
    assert condition.form_signal(10, 1.0, ok)["state"] == "race"
    assert condition.form_signal(-15, 1.1, ok)["state"] == "train"
    assert condition.form_signal(-35, 1.1, ok)["state"] == "rest"
    assert condition.form_signal(-5, 1.6, ok)["state"] == "rest"
    assert condition.form_signal(10, 1.0, {"level": "very_low"})["state"] == "rest"
    assert condition.form_signal(-15, 1.0, ok)["band"] == "productive"


def test_ramp_states():
    assert [condition.ramp_signal(v)["state"] for v in (None, 0.6, 1.0, 1.4, 1.7)] == ["unknown", "low", "ok", "fast", "risk"]


def test_condition_endpoint_shape():
    with TestClient(app) as c:
        body = c.get("/api/condition").json()
    assert body["headline"] and isinstance(body["advice"], list)
    assert {"fitness", "fatigue", "form", "ramp", "intensity", "bands"} <= body.keys()
    assert body["easy_target_pct"] == 80 and len(body["intensity"]) == 12
