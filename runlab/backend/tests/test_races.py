from datetime import date, datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.db import engine, init_db
from app.main import app
from app.models import Activity, GoalRace, Plan, PlannedWorkout
from app.planner import races as races_mod


def _reset():
    init_db()
    with Session(engine) as s:
        s.exec(delete(PlannedWorkout))
        s.exec(delete(Plan))
        s.exec(delete(GoalRace))
        s.commit()


def _workouts(day: date) -> list[PlannedWorkout]:
    with Session(engine) as s:
        return list(s.exec(select(PlannedWorkout).where(PlannedWorkout.day == day)))


def test_plan_built_around_saved_race_and_folds_in_others():
    _reset()
    today = date.today()
    goal_day = today + timedelta(weeks=16)
    half_day = today + timedelta(weeks=8)
    with TestClient(app) as c:
        goal = c.post("/api/races", json={"name": "목표 풀", "race_day": goal_day.isoformat(), "distance_m": 42195,
                                          "target_time_s": 12600, "priority": "A"}).json()
        half = c.post("/api/races", json={"name": "중간 하프", "race_day": half_day.isoformat(), "distance_m": 21097.5,
                                          "priority": "B", "location": "춘천"}).json()
        assert half["d_day"] == 56
        assert half["predicted_time_s"] is None or isinstance(half["predicted_time_s"], (int, float))

        r = c.post("/api/plans", json={"race_id": goal["id"], "race": {"name": "목표 풀", "race_day": goal_day.isoformat(),
                                                                     "distance_m": 42195, "target_time_s": 12600}})
        assert r.status_code == 200
        races = c.get("/api/races").json()
        assert len(races) == 2  # no duplicate race created
        by_name = {x["name"]: x for x in races}
        assert by_name["목표 풀"]["is_plan_goal"] and by_name["목표 풀"]["in_plan"]
        assert by_name["중간 하프"]["in_plan"]  # folded in automatically at plan creation

    half_ws = _workouts(half_day)
    assert [w.kind for w in half_ws] == ["race"] and half_ws[0].race_id == half["id"] and half_ws[0].note == "춘천"
    # Half marathon (B): day after is rest, no hard sessions in the next 4 days.
    after = [w for k in range(1, 5) for w in _workouts(half_day + timedelta(days=k))]
    assert all(w.kind not in ("tempo", "interval", "mp", "long") for w in after)
    assert all(w.kind == "rest" for w in _workouts(half_day + timedelta(days=1)))
    # Day before: light shakeout at most.
    assert all(w.kind in ("easy", "rest") and (w.target_distance_m or 0) <= 4000 for w in _workouts(half_day - timedelta(days=1)))


def test_c_race_preview_apply_is_idempotent_and_unlinks_on_move():
    _reset()
    today = date.today()
    with TestClient(app) as c:
        c.post("/api/plans", json={"race": {"name": "목표 하프", "race_day": (today + timedelta(weeks=12)).isoformat(),
                                             "distance_m": 21097.5}})
        with Session(engine) as s:
            plan = s.exec(select(Plan).where(Plan.active.is_(True))).one()
            # Put the C race on a planned quality-session day.
            q = s.exec(select(PlannedWorkout).where(PlannedWorkout.plan_id == plan.id, PlannedWorkout.kind.in_(["tempo", "interval"]),
                                                    PlannedWorkout.day > today + timedelta(days=3))).first()
            c_day = q.day
        tenk = c.post("/api/races", json={"name": "동네 10K", "race_day": c_day.isoformat(), "distance_m": 10000, "priority": "C"}).json()
        assert not tenk["in_plan"] and tenk["in_plan_period"]

        preview = {x["id"]: x for x in c.get("/api/plans/races").json()}[tenk["id"]]
        ops = preview["changes"]
        assert ops[0]["op"] == "race" and ops[0]["before"]["kind"] in ("tempo", "interval")
        assert all(o["op"] in ("race", "easy") for o in ops)

        assert c.post("/api/plans/races/apply", json={"race_ids": [tenk["id"]]}).json()["changed"] == len(ops)
        assert {x["id"]: x for x in c.get("/api/plans/races").json()}[tenk["id"]]["changes"] == []  # idempotent
        w = _workouts(c_day)[0]
        assert w.kind == "race" and w.structure[0]["pace"] == "I" and w.target_tss > 40

        # Moving the race turns the old race day into rest and makes it re-appliable.
        c.patch(f"/api/races/{tenk['id']}", json={"race_day": (c_day + timedelta(days=7)).isoformat()})
        assert _workouts(c_day)[0].kind == "rest" and _workouts(c_day)[0].race_id is None
        assert {x["id"]: x for x in c.get("/api/plans/races").json()}[tenk["id"]]["changes"]

        c.delete(f"/api/races/{tenk['id']}")
        assert all(x["id"] != tenk["id"] for x in c.get("/api/races").json())


def test_past_race_links_its_result():
    _reset()
    day = date.today() - timedelta(days=20)
    with Session(engine) as s:
        a = Activity(name="Run Your Way 10K", start_time=datetime.combine(day, datetime.min.time()) + timedelta(hours=8),
                     distance_m=10050, duration_s=2700, moving_time_s=2690, run_type="race")
        s.add(a)
        s.add(GoalRace(name="10K", race_day=day, distance_m=10000, priority="B"))
        s.commit()
        aid = a.id
    with TestClient(app) as c:
        r = next(x for x in c.get("/api/races").json() if x["name"] == "10K")
    assert r["result"]["activity_id"] == aid and r["result"]["time_s"] == 2690 and r["d_day"] == -20


def test_race_validation():
    with TestClient(app) as c:
        assert c.post("/api/races", json={"name": "x", "race_day": "2027-01-01", "distance_m": 10000, "priority": "Z"}).status_code == 400


def test_race_tss_scales_with_distance():
    assert races_mod.race_tss(42195, 3 * 3600) > races_mod.race_tss(10000, 45 * 60)
    assert races_mod.race_zone(5000) == "I" and races_mod.race_zone(21097.5) == "T" and races_mod.race_zone(42195) == "M"


def test_old_plan_goal_race_gets_linked_not_duplicated():
    _reset()
    today = date.today()
    with TestClient(app) as c:
        c.post("/api/plans", json={"race": {"name": "옛 플랜", "race_day": (today + timedelta(weeks=10)).isoformat(), "distance_m": 21097.5}})
        with Session(engine) as s:  # simulate a plan created before race links existed
            for w in s.exec(select(PlannedWorkout).where(PlannedWorkout.kind == "race")):
                w.race_id = None
                s.add(w)
            s.commit()
        pr = c.get("/api/plans/races").json()
        assert len(pr) == 1 and pr[0]["is_plan_goal"] and pr[0]["in_plan"] and pr[0]["changes"] == []
    with Session(engine) as s:
        assert len(s.exec(select(PlannedWorkout).where(PlannedWorkout.kind == "race")).all()) == 1
