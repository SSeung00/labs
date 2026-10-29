from datetime import date, timedelta

import pytest

from app.planner.generator import PlanParams, generate, phase_plan


def _params(**kw):
    base = {
        "race_distance_m": 21097.5,
        "race_day": date(2027, 3, 28),  # a Sunday
        "start_day": date(2026, 12, 7),  # a Monday
        "days_per_week": 5,
        "long_run_dow": 6,
        "current_weekly_km": 30,
        "vdot": 45,
        "goal_time_s": 95 * 60,
    }
    base.update(kw)
    return PlanParams(**base)


def test_phases_end_with_taper_and_cover_all_weeks():
    ph = phase_plan(16, 21097.5)
    assert len(ph) == 16 and ph[-2:] == ["taper", "taper"]
    assert ph.index("build") > ph.index("base") if "base" in ph else True


def test_generate_halfmarathon_plan():
    workouts, weeks = generate(_params())
    assert weeks[0]["phase"] == "base" and weeks[-1]["phase"] == "taper"
    race = [w for w in workouts if w.kind == "race"]
    assert len(race) == 1 and race[0].day == date(2027, 3, 28)
    # Respect days per week (race week may differ) and never two workouts on one day.
    by_week: dict = {}
    for w in workouts:
        by_week.setdefault(w.day - timedelta(days=w.day.weekday()), []).append(w)
    for wk, items in by_week.items():
        days = [x.day for x in items]
        assert len(days) == len(set(days)), wk
        assert len(items) <= 5
    # Weekly volume grows ≤ ~10% over the best recent week (returning from a cutback is fine).
    vols = [w["target_km"] for w in weeks]
    for i in range(1, len(vols)):
        assert vols[i] <= max(vols[max(0, i - 2) : i]) * 1.1 + 0.6
    assert all(w.target_tss > 0 for w in workouts)


def test_long_run_on_requested_day():
    workouts, _ = generate(_params(long_run_dow=5))
    longs = [w for w in workouts if w.kind == "long"]
    assert longs and all(w.day.weekday() == 5 for w in longs)


def test_too_short_raises():
    with pytest.raises(ValueError):
        generate(_params(start_day=date(2027, 3, 26)))


def test_plan_api_lifecycle():
    from fastapi.testclient import TestClient

    from app.main import app

    body = {
        "race": {"name": "테스트 하프", "race_day": "2027-03-28", "distance_m": 21097.5, "target_time_s": 5700},
        "start_day": "2026-12-07",
        "days_per_week": 4,
        "current_weekly_km": 25,
    }
    with TestClient(app) as c:
        prev = c.post("/api/plans/preview", json=body)
        assert prev.status_code == 200, prev.text
        assert prev.json()["weeks"][-1]["phase"] == "taper"
        view = c.post("/api/plans", json=body).json()
        assert view["plan"]["active"] and view["workouts"]
        wid = view["workouts"][0]["id"]
        moved = c.patch(f"/api/workouts/{wid}", json={"day": "2026-12-09"}).json()
        assert moved["day"] == "2026-12-09"
        easy = c.patch(f"/api/workouts/{wid}", json={"kind": "easy"}).json()
        assert easy["kind"] == "easy" and easy["structure"][0]["pace"] == "E"
        active = c.get("/api/plans/active").json()
        assert active["race"]["name"] == "테스트 하프"
        assert c.delete(f"/api/plans/{active['plan']['id']}").json()["ok"]
        assert c.get("/api/plans/active").json() is None
