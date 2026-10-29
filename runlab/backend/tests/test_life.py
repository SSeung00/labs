from datetime import date

import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from app.analytics import insights as I
from app.main import app


def test_gear_assign_and_mileage():
    from datetime import datetime

    from sqlmodel import Session

    from app.db import engine
    from app.models import Activity

    with TestClient(app) as c:
        with Session(engine) as s:
            s.add(Activity(name="Easy", sport="running", start_time=datetime(2001, 1, 1, 7), distance_m=8000, duration_s=2800))
            s.commit()
        shoe = c.post("/api/gear", json={"name": "테스트 신발", "initial_km": 10, "is_default": True}).json()
        r = c.post(f"/api/gear/{shoe['id']}/assign", json={"start": "2000-01-01"}).json()
        assert r["assigned"] >= 1  # fixture runs from other tests
        g = next(x for x in c.get("/api/gear").json() if x["id"] == shoe["id"])
        assert g["km"] > 10 and g["runs"] == r["assigned"]
        assert c.delete(f"/api/gear/{shoe['id']}").json()["ok"]


def test_active_injury_lowers_readiness():
    with TestClient(app) as c:
        base = c.get("/api/readiness").json()["score"]
        inj = c.post("/api/injuries", json={"body_part": "무릎", "side": "left", "severity": 3, "start_day": date.today().isoformat()}).json()
        hurt = c.get("/api/readiness").json()
        assert hurt["score"] < base and any("무릎" in f for f in hurt["flags"])
        c.delete(f"/api/injuries/{inj['id']}")


def test_correlate_lag_alignment():
    idx = pd.date_range("2026-01-01", periods=40, freq="D")
    x = np.random.default_rng(1).normal(size=40)
    df = pd.DataFrame({"x": x, "y": np.r_[np.zeros(2), x[:-2]]}, index=idx)  # y(d) = x(d-2)
    assert I.correlate(df, "x", "y", lag=2)["rho"] == 1.0
    assert abs(I.correlate(df, "x", "y", lag=0)["rho"]) < 0.5


def test_shoe_key_matches_user_spellings():
    from app.ingest.shoes_csv import shoe_key

    assert shoe_key("Adizero Evo SL") == shoe_key("EVO SL")
    assert shoe_key("1080 V15 B") == shoe_key("1080 V15 (Black)")
    assert shoe_key("1080 V15 W") == shoe_key("1080 V15")
    assert shoe_key("Cloudmonster 2") == shoe_key("Cloud Monster 2")
    assert shoe_key("Adizero Boston 13") == shoe_key("Boston 13")
