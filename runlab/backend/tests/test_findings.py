from datetime import date

import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from app.analytics import findings
from app.main import app

CATALOG = [
    {"group": "일지", "key": "j:sleep_hours", "label": "수면 시간", "unit": "h", "polarity": "higher_better"},
    {"group": "가민", "key": "steps", "label": "걸음 수", "unit": "", "polarity": "neutral"},
    {"group": "러닝", "key": "ef", "label": "EF", "unit": "", "polarity": "higher_better"},
]


def _frame(n: int = 80, seed: int = 1) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    idx = pd.date_range(date(2026, 6, 1), periods=n, freq="D")
    sleep = rng.uniform(5, 9, n)
    ef = 1.6 + rng.normal(0, 0.02, n)
    ef[1:] += (sleep[:-1] >= 7) * 0.06  # good sleep → better efficiency the next day
    steps = rng.uniform(5000, 15000, n)
    return pd.DataFrame({"j:sleep_hours": sleep, "ef": ef, "pace": 330.0, "run_km": rng.uniform(5, 15, n), "steps": steps}, index=idx)


def test_next_day_sleep_effect_becomes_a_sentence():
    out = findings.from_frame(_frame(), CATALOG)
    f = next(x for x in out if x["cause"] == "j:sleep_hours")
    assert f["lag"] == 1 and f["outcome"] == "ef" and f["good"]
    assert f["text"].startswith("수면 시간 7시간 이상인 날의 다음 날, 같은 심박에서 페이스가 평균")
    assert "빨라요" in f["text"] and f["basis"].startswith("기록 ")
    assert not any(x["cause"] == "steps" for x in out)  # pure noise stays out


def test_no_findings_without_enough_days():
    assert findings.from_frame(_frame(n=10), CATALOG) == []


def test_adjust_outcome_removes_distance_effect():
    df = _frame()
    df["decoupling"] = 2 + df["run_km"] * 0.5  # entirely explained by distance
    adj = findings.adjust_outcome(df, "decoupling")
    assert adj.std() < 1e-6


def test_findings_endpoint():
    with TestClient(app) as c:
        r = c.get("/api/insights/findings")
    assert r.status_code == 200 and isinstance(r.json(), list)
