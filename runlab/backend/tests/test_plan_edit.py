from datetime import date, datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.db import engine, init_db
from app.main import app
from app.models import Activity, GoalRace, Lap, Plan, PlannedWorkout


def _reset():
    init_db()
    with Session(engine) as s:
        s.exec(delete(PlannedWorkout))
        s.exec(delete(Plan))
        s.exec(delete(GoalRace))
        s.commit()


def _plan(c: TestClient, weeks: int = 14, days: int = 5) -> dict:
    day = (date.today() + timedelta(weeks=weeks)).isoformat()
    r = c.post("/api/plans", json={"race": {"name": "테스트 하프", "race_day": day, "distance_m": 21097.5, "target_time_s": 5700},
                                   "start_day": date.today().isoformat(), "days_per_week": days, "long_run_dow": 6})
    assert r.status_code == 200
    return r.json()


def _future(plan: dict, kind: str | None = None) -> list[dict]:
    today = date.today().isoformat()
    return [w for w in plan["workouts"] if w["day"] > today and (kind is None or w["kind"] == kind)]


def test_template_changes_kind_structure_and_load():
    _reset()
    with TestClient(app) as c:
        w = _future(_plan(c), "easy")[0]
        r = c.post(f"/api/workouts/{w['id']}/template", json={"template": "cruise", "km": 10})
        assert r.status_code == 200
        body = r.json()
        assert body["kind"] == "tempo" and body["title"].startswith("크루즈 인터벌")
        assert any(s["type"] == "repeat" for s in body["structure"]) and body["target_tss"] > 0
        assert 8000 < body["target_distance_m"] < 12000
        assert c.post(f"/api/workouts/{w['id']}/template", json={"template": "nope", "km": 10}).status_code == 400
        rest = c.post(f"/api/workouts/{w['id']}/template", json={"template": "rest"}).json()
        assert rest["kind"] == "rest" and rest["target_distance_m"] == 0
        assert {t["key"] for t in c.get("/api/workouts/templates").json()} >= {"easy", "vo2", "long", "rest"}


def test_swap_exchanges_days_and_protects_races():
    _reset()
    with TestClient(app) as c:
        plan = _plan(c)
        a, b = _future(plan, "easy")[0], _future(plan, "long")[0]
        assert c.post(f"/api/workouts/{a['id']}/swap", json={"day": b["day"]}).json()["moved"] == 2
        with Session(engine) as s:
            assert s.get(PlannedWorkout, a["id"]).day.isoformat() == b["day"]
            assert s.get(PlannedWorkout, b["id"]).day.isoformat() == a["day"]
        race = next(w for w in plan["workouts"] if w["kind"] == "race")
        assert c.post(f"/api/workouts/{a['id']}/swap", json={"day": race["day"]}).status_code == 400
        assert c.post(f"/api/workouts/{a['id']}/swap", json={"day": (date.today() - timedelta(days=3)).isoformat()}).status_code == 400


def test_week_lighter_and_recovery_preview_then_apply():
    _reset()
    with TestClient(app) as c:
        plan = _plan(c, days=6)
        # A build week with two hard sessions.
        week = next(wk for wk in plan["weeks"] if wk["phase"] == "build")
        monday = week["week_start"]
        prev = c.post("/api/plans/week", json={"week_start": monday, "action": "lighter"}).json()["changes"]
        assert prev and all(ch["after"]["km"] <= ch["before"]["km"] for ch in prev)
        with Session(engine) as s:
            before_km = sum(w.target_distance_m or 0 for w in s.exec(select(PlannedWorkout).where(
                PlannedWorkout.day >= date.fromisoformat(monday), PlannedWorkout.day < date.fromisoformat(monday) + timedelta(days=7))))
        assert c.post("/api/plans/week", json={"week_start": monday, "action": "lighter", "dry_run": False}).json()["changed"] == len(prev)
        with Session(engine) as s:
            ws = list(s.exec(select(PlannedWorkout).where(
                PlannedWorkout.day >= date.fromisoformat(monday), PlannedWorkout.day < date.fromisoformat(monday) + timedelta(days=7))))
        assert sum(w.target_distance_m or 0 for w in ws) < before_km
        assert sum(w.kind in ("tempo", "interval", "mp") for w in ws) == 1  # one hard session kept

        rec = c.post("/api/plans/week", json={"week_start": monday, "action": "recovery", "dry_run": False}).json()
        assert rec["changed"] > 0
        with Session(engine) as s:
            ws = list(s.exec(select(PlannedWorkout).where(
                PlannedWorkout.day >= date.fromisoformat(monday), PlannedWorkout.day < date.fromisoformat(monday) + timedelta(days=7))))
        assert all(w.kind in ("easy", "rest") for w in ws)
        assert c.post("/api/plans/week", json={"week_start": monday, "action": "bogus"}).status_code == 400


def test_regenerate_keeps_past_and_skipped_and_changes_layout():
    _reset()
    with TestClient(app) as c:
        plan = _plan(c, days=5)
        skipped = _future(plan, "easy")[2]
        c.patch(f"/api/workouts/{skipped['id']}", json={"status": "skipped"})
        prev = c.post("/api/plans/regenerate", json={"days_per_week": 4, "long_run_dow": 5, "peak_weekly_km": 50}).json()
        assert prev["replaced"] > 0 and prev["created"] > 0 and prev["weeks"]
        with Session(engine) as s:
            n_before = len(list(s.exec(select(PlannedWorkout))))
        assert prev["replaced"] and n_before  # dry run changed nothing
        r = c.post("/api/plans/regenerate", json={"days_per_week": 4, "long_run_dow": 5, "peak_weekly_km": 50, "dry_run": False})
        assert r.status_code == 200
        active = c.get("/api/plans/active").json()
        assert active["plan"]["params"]["days_per_week"] == 4 and active["plan"]["params"]["peak_weekly_km"] == 50
        # This week stays as it was; from the next Monday the long run moves to Saturday.
        assert date.fromisoformat(prev["from_day"]).weekday() == 0 and prev["from_day"] > date.today().isoformat()
        longs = [w for w in active["workouts"] if w["kind"] == "long" and w["day"] >= prev["from_day"]]
        assert longs and all(date.fromisoformat(w["day"]).weekday() == 5 for w in longs)
        assert any(w["id"] == skipped["id"] for w in active["workouts"])  # skipped one survives
        races = [w for w in active["workouts"] if w["kind"] == "race"]
        assert len(races) == 1 and races[0]["race_id"] == active["plan"]["goal_race_id"]
        assert c.post("/api/plans/regenerate", json={"days_per_week": 9, "long_run_dow": 5}).status_code == 400


def test_review_pairs_structured_laps_and_judges_pace():
    _reset()
    with TestClient(app) as c:
        plan = _plan(c)
        w = _future(plan, "easy")[0]
        # 3×1km at I pace with 400 m jogs, sent to the watch → laps match the steps.
        c.post(f"/api/workouts/{w['id']}/template", json={"template": "vo2", "km": 7.5})
        targets = c.get(f"/api/workouts/{w['id']}/review").json()
        assert targets["main_zone"] == "I" and targets["actual"] is None
        i_band = targets["targets"]["I"]["pace"]
        assert targets["targets"]["I"]["hr"][0] < targets["targets"]["I"]["hr"][1]

        with Session(engine) as s:
            pw = s.get(PlannedWorkout, w["id"])
            flat = []
            for st in pw.structure:
                flat += [x for _ in range(st.get("reps", 1)) for x in st["steps"]] if st["type"] == "repeat" else [st]
            start = datetime.combine(pw.day, datetime.min.time()) + timedelta(hours=7)
            a = Activity(garmin_id=None, name="인터벌", sport="running", start_time=start, distance_m=0, duration_s=0)
            s.add(a)
            s.flush()
            total_d = total_t = 0.0
            rep = 0
            for i, st in enumerate(flat):
                d = st.get("distance_m") or 300
                if st.get("pace") == "I":
                    rep += 1
                    pace = i_band["fast"] - 30 if rep == 1 else (i_band["slow"] + i_band["fast"]) / 2
                else:
                    pace = 360
                t = d / 1000 * pace
                s.add(Lap(activity_id=a.id, idx=i, distance_m=d, duration_s=t, avg_hr=160))
                total_d += d
                total_t += t
            a.distance_m, a.duration_s, a.moving_time_s = total_d, total_t, total_t
            s.add(a)
            s.commit()
            aid = a.id

        rv = c.get(f"/api/workouts/{w['id']}/review").json()["actual"]
        assert rv["activity_id"] == aid and rv["paired"]
        verdicts = [r["verdict"] for r in rv["reps"]]
        assert verdicts[0] == "fast" and all(v == "on" for v in verdicts[1:])
        assert rv["main_pace"] is not None
        with Session(engine) as s:
            s.exec(delete(Lap).where(Lap.activity_id == aid))
            s.delete(s.get(Activity, aid))
            s.commit()


def test_regenerate_keeps_recovery_after_a_past_race():
    _reset()
    from app.planner import edit as edit_mod

    with TestClient(app) as c:
        _plan(c, weeks=12, days=6)
        with Session(engine) as s:
            plan = s.exec(select(Plan)).first()
            # A marathon two days ago, its recovery reaching into next week.
            today = date.today()
            race_day = today - timedelta(days=2)
            s.add(PlannedWorkout(plan_id=plan.id, day=race_day, kind="race", title="지난 풀", phase="base", target_distance_m=42195))
            start = edit_mod.regen_from(s, plan, today)
            protected = edit_mod._protected_days(s, plan, start)
            s.commit()
        assert all(race_day < d <= race_day + timedelta(days=7) and d >= start for d in protected)
        assert len(protected) == max(0, (race_day + timedelta(days=7) - start).days + 1)
