from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.db import engine, init_db
from app.main import app
from app.models import GoalRace, Plan, PlannedWorkout
from app.planner import weekly_check


def _reset():
    init_db()
    with Session(engine) as s:
        s.exec(delete(PlannedWorkout))
        s.exec(delete(Plan))
        s.exec(delete(GoalRace))
        s.commit()


def _plan(c: TestClient, start: date) -> None:
    r = c.post("/api/plans", json={"race": {"name": "검사 하프", "race_day": (start + timedelta(weeks=14)).isoformat(), "distance_m": 21097.5},
                                   "start_day": start.isoformat(), "days_per_week": 5, "long_run_dow": 6})
    assert r.status_code == 200


def test_target_week():
    assert weekly_check.target_week(date(2026, 11, 2)) == date(2026, 11, 2)  # Monday: this week
    assert weekly_check.target_week(date(2026, 11, 5)) == date(2026, 11, 9)


def test_running_far_less_than_planned_trims_next_week_and_apply_marks_it():
    _reset()
    monday = date.today() - timedelta(days=date.today().weekday())
    start = monday - timedelta(weeks=2)
    with TestClient(app) as c:
        _plan(c, start)
        with Session(engine) as s:
            plan = s.exec(select(Plan)).first()
            today = monday + timedelta(days=3)  # Thursday; nothing was run for two weeks
            r = weekly_check.check(s, plan, today)
            assert r["week_start"] == (monday + timedelta(days=7)).isoformat()
            assert r["stats"]["ratio"] < 0.8 and r["stats"]["missed"] >= 1
            assert r["changes"] and all(ch["after"]["km"] < ch["before"]["km"] for ch in r["changes"])
            ids = [ch["workout_id"] for ch in r["changes"]]
            before = {i: s.get(PlannedWorkout, i).target_distance_m for i in ids}
            n = weekly_check.apply(s, plan, today)
            assert n == len(ids)
            s.expire_all()
            assert all(s.get(PlannedWorkout, i).target_distance_m < before[i] for i in ids)
            assert weekly_check.check(s, plan, today)["status"] == "applied"


def test_api_check_and_dismiss():
    _reset()
    with TestClient(app) as c:
        assert c.get("/api/plans/check").json() is None
        _plan(c, date.today())
        body = c.get("/api/plans/check").json()
        assert {"week_start", "notes", "changes", "stats", "goal", "status"} <= body.keys()
        assert c.post("/api/plans/check/dismiss").json()["ok"]
        assert c.get("/api/plans/check").json()["status"] == "dismissed"
