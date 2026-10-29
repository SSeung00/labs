from datetime import datetime

from app.analytics.profile import EffectiveProfile
from app.analytics.run_type import classify, from_title
from app.ingest.shoes_csv import parse
from app.models import Activity, Lap

PROF = EffectiveProfile(max_hr=188, rest_hr=47, lthr=177, zone_bounds=[150, 157, 166, 177], zone_method="lthr")


def _act(**kw):
    base = {"sport": "running", "start_time": datetime(2026, 5, 1, 7), "distance_m": 10000, "duration_s": 3600, "moving_time_s": 3600, "avg_hr": 140}
    base.update(kw)
    return Activity(**base)


def test_titles():
    assert from_title("Seoul Half Marathon").run_type == "race"
    assert from_title("Goguryeo 10K").run_type == "race"
    assert from_title("6K Tempo").run_type == "workout"
    assert from_title("5km TT").run_type == "workout"  # time trial, not a race
    assert from_title("LSD").run_type == "long"
    assert from_title("Long Run (Build-up)").run_type == "long"
    assert from_title("Active Recov").run_type == "recovery"
    assert from_title("Easy + Stride x2").run_type in ("easy", "workout")
    assert from_title("Warm-up").wucd
    assert from_title("Running") is None  # generic → physiology


def test_physiology_long_and_workout():
    assert classify(_act(distance_m=24000, moving_time_s=8800), [], PROF).run_type == "long"
    hard = _act(zone_seconds=[600, 600, 600, 1200, 600])
    assert classify(hard, [], PROF).run_type == "workout"
    easy = _act(avg_hr=138, zone_seconds=[3500, 100, 0, 0, 0])
    assert classify(easy, [], PROF).run_type in ("easy", "recovery")


def test_interval_laps_detected():
    laps = [Lap(activity_id=1, idx=i, distance_m=800 if i % 2 else 400, duration_s=200 if i % 2 else 160, avg_speed_mps=4.0 if i % 2 else 2.5) for i in range(8)]
    assert classify(_act(zone_seconds=[3000, 600, 0, 0, 0]), laps, PROF).run_type == "workout"


def test_csv_parse():
    text = 'Type,Date,Title,Distance,Time(hrs),Time(min),Time(sec),Pace(min),Pace(sec),Avg HR,Shoe,Shoe Cum Dist\n' \
           'Half,"2026-04-26, 07:30",Seoul Half Marathon,21.12,1,34,54,4,30,172,Adizero Adios Pro 4,172.28\n'
    rows = parse(text)
    assert rows[0]["type"] == "Half" and rows[0]["km"] == 21.12 and rows[0]["when"] == datetime(2026, 4, 26, 7, 30)


def test_monthly_and_month_filter():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        months = c.get("/api/activities/monthly").json()
        assert isinstance(months, list)
        for m in months:
            assert {"month", "count", "distance_m", "duration_s", "by_type"} <= m.keys()
        assert c.get("/api/activities?month=2026-13").status_code == 422
        r = c.get("/api/activities?month=2026-10")
        assert r.status_code == 200
        assert all(a["start_time"].startswith("2026-10") for a in r.json()["items"])
