from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.db import engine
from app.ingest import auto_sync
from app.main import app

CFG = {"enabled": True, "time": "08:00"}


def at(h, m=0, day=20):
    return datetime(2026, 10, day, h, m)


def test_should_run_rules():
    assert not auto_sync.should_run(CFG, None, at(7, 59))          # before the time
    assert auto_sync.should_run(CFG, None, at(8, 0))               # time reached, nothing today
    assert auto_sync.should_run(CFG, None, at(22, 0))              # PC was off at 8: catch up
    assert not auto_sync.should_run({**CFG, "enabled": False}, None, at(9))
    ok = {"day": "2026-10-20", "started_at": "2026-10-20T08:00:00", "attempts": 1, "ok": True}
    assert not auto_sync.should_run(CFG, ok, at(12))               # already done today
    assert auto_sync.should_run(CFG, ok, at(8, 0, day=21))         # tomorrow again
    failed = {**ok, "ok": False}
    assert not auto_sync.should_run(CFG, failed, at(8, 30))        # wait an hour before retrying
    assert auto_sync.should_run(CFG, failed, at(9, 0))
    assert not auto_sync.should_run(CFG, {**failed, "attempts": 3}, at(15))  # out of retries
    assert not auto_sync.should_run(CFG, {**ok, "ok": None, "running": True}, at(10))


def test_next_run():
    assert auto_sync.next_run(CFG, None, at(7)) == "2026-10-20T08:00"
    ok = {"day": "2026-10-20", "started_at": "2026-10-20T08:00:00", "attempts": 1, "ok": True}
    assert auto_sync.next_run(CFG, ok, at(9)) == "2026-10-21T08:00"
    failed = {**ok, "ok": False}
    assert auto_sync.next_run(CFG, failed, at(8, 20)) == "2026-10-20T09:00"
    assert auto_sync.next_run({**CFG, "enabled": False}, None, at(7)) is None


class FakeSync:
    def __init__(self):
        self.running = False
        self.started = 0

    def start(self, full=False):
        assert full is False  # daily sync is always the light incremental one
        if self.running:
            return False
        self.running, self.started = True, self.started + 1
        return True

    def snapshot(self):
        return {"running": self.running, "phase": "done", "finished_at": "2026-10-20T08:01:10",
                "new_activities": 2, "new_wellness_days": 1, "error": None}


@pytest.fixture
def fake(monkeypatch):
    with TestClient(app), Session(engine) as s:
        auto_sync.set_config(s, True, "08:00")
        auto_sync._save_last(s, None)
    f = FakeSync()
    monkeypatch.setattr(auto_sync, "sync_manager", f)
    monkeypatch.setattr(auto_sync, "garmin_auth", SimpleNamespace(status=lambda: SimpleNamespace(connected=True)))
    return f


def test_tick_starts_once_and_records_result(fake):
    assert auto_sync.tick(at(7)) == "idle"
    assert auto_sync.tick(at(8, 1)) == "started"
    assert auto_sync.tick(at(8, 2)) == "idle"            # still running: not started twice
    fake.running = False
    assert auto_sync.tick(at(8, 3)) == "recorded"
    with Session(engine) as s:
        last = auto_sync.last_run(s)
    assert last["ok"] and last["new_activities"] == 2 and last["attempts"] == 1
    assert auto_sync.tick(at(18)) == "idle"              # done for today
    assert fake.started == 1


def test_tick_waits_when_not_connected_or_busy(fake, monkeypatch):
    monkeypatch.setattr(auto_sync, "garmin_auth", SimpleNamespace(status=lambda: SimpleNamespace(connected=False)))
    assert auto_sync.tick(at(9)) == "not-connected"
    monkeypatch.setattr(auto_sync, "garmin_auth", SimpleNamespace(status=lambda: SimpleNamespace(connected=True)))
    fake.running = True  # a manual sync is in progress
    assert auto_sync.tick(at(9)) == "busy"


def test_api_roundtrip():
    with TestClient(app) as c:
        r = c.put("/api/sync/auto", json={"enabled": True, "time": "06:30"})
        assert r.status_code == 200 and r.json()["time"] == "06:30"
        assert c.put("/api/sync/auto", json={"enabled": True, "time": "25:99"}).status_code == 400
        body = c.get("/api/sync/auto").json()
        assert {"enabled", "time", "active", "last", "next_run"} <= body.keys()
        assert body["active"] is False  # tests never run the real scheduler
        c.put("/api/sync/auto", json={"enabled": True, "time": "08:00"})
