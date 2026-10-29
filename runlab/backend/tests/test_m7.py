from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.coach import report as coach
from app.db import engine
from app.main import app
from app.planner.garmin_workout import build


def test_garmin_workout_payload_shape():
    steps = [
        {"type": "warmup", "distance_m": 2000, "pace": "E"},
        {"type": "repeat", "reps": 5, "steps": [{"type": "run", "distance_m": 1000, "pace": "I"}, {"type": "recover", "distance_m": 400, "pace": "E"}]},
        {"type": "cooldown", "distance_m": 1500, "pace": "E"},
    ]
    p = build("VO2max 인터벌", steps, vdot=45, race_pace_s_per_km=None)
    seg = p["workoutSegments"][0]["workoutSteps"]
    assert [s["stepType"]["stepTypeKey"] for s in seg] == ["warmup", "repeat", "cooldown"]
    rep = seg[1]
    assert rep["numberOfIterations"] == 5
    work = rep["workoutSteps"][0]
    assert work["targetType"]["workoutTargetTypeKey"] == "pace.zone"
    assert work["targetValueOne"] < work["targetValueTwo"]  # slower speed is the lower bound
    assert seg[0]["targetType"]["workoutTargetTypeKey"] == "no.target"
    orders = [seg[0]["stepOrder"], rep["stepOrder"], *[s["stepOrder"] for s in rep["workoutSteps"]], seg[2]["stepOrder"]]
    assert orders == sorted(set(orders))
    assert 1800 < p["estimatedDurationInSecs"] < 4000


class _FakeMessages:
    def __init__(self):
        self.kwargs = None

    def create(self, **kw):
        self.kwargs = kw
        return SimpleNamespace(
            stop_reason="end_turn",
            model="claude-opus-5-5",
            content=[SimpleNamespace(type="text", text="## 한 줄 요약\n- 좋아요")],
            usage=SimpleNamespace(input_tokens=1000, output_tokens=200),
        )


def test_coach_report_uses_summary_only_and_saves():
    from sqlmodel import Session

    fake = _FakeMessages()
    client = SimpleNamespace(beta=SimpleNamespace(messages=fake))
    with TestClient(app), Session(engine) as s:
        r = coach.generate_weekly(s, client=client)
    assert r.markdown.startswith("## 한 줄 요약")
    kw = fake.kwargs
    assert kw["model"] == "claude-opus-5-5" and kw["fallbacks"] == "default"
    body = kw["messages"][0]["content"]
    assert '"lat"' not in body and "route" not in body  # no GPS leaves the machine


def test_csv_export():
    with TestClient(app) as c:
        r = c.get("/api/export/activities.csv")
        assert r.status_code == 200 and r.text.lstrip("﻿").startswith("id,garmin_id")
        assert c.get("/api/export/daily.csv").status_code == 200
