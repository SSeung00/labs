import io
import time
import zipfile
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.ingest import garmin_sync
from app.main import app
from tests.fit_factory import make_run_fit


def test_zip_import_job(monkeypatch):
    monkeypatch.setattr(garmin_sync, "fetch_weather", lambda *a, **k: {"temp_c": 20.0})
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        start = datetime(2025, 5, 5, 22, 0, tzinfo=UTC)  # distinct from other tests' fixtures
        z.writestr("a.fit", make_run_fit(start=start, seconds=90))
        z.writestr("b.fit", make_run_fit(start=start, seconds=90))  # same start → duplicate
    with TestClient(app) as client:
        res = client.post("/api/import/files", files=[("files", ("export.zip", buf.getvalue(), "application/zip"))])
        assert res.status_code == 200, res.text
        for _ in range(100):
            st = client.get("/api/sync/status").json()
            if not st["running"]:
                break
            time.sleep(0.05)
        assert st["phase"] == "done", st
        assert st["new_activities"] == 1
        acts = [a for a in client.get("/api/activities").json()["items"] if a["start_time"].startswith("2025-05-06")]
        assert len(acts) == 1 and acts[0]["has_stream"]
        assert acts[0]["weather"] == {"temp_c": 20.0}


def test_sync_requires_login():
    with TestClient(app) as client:
        assert client.post("/api/sync/start", json={}).status_code == 400


def test_journal_roundtrip_and_readiness():
    with TestClient(app) as client:
        defs = {d["key"] for d in client.get("/api/journal/defs").json()}
        assert {"sleep_hours", "fatigue", "soreness"} <= defs
        day = "2026-01-15"
        r = client.put(f"/api/journal/{day}", json={"sleep_hours": 7.5, "fatigue": 2, "memo": "좋음"})
        assert r.status_code == 200, r.text
        assert r.json() == {"sleep_hours": 7.5, "fatigue": 2.0, "memo": "좋음"}
        r = client.put(f"/api/journal/{day}", json={"fatigue": None})
        assert "fatigue" not in r.json()
        assert client.put(f"/api/journal/{day}", json={"nope": 1}).status_code == 400
        rd = client.get("/api/readiness", params={"day": day}).json()
        assert rd["has_checkin"] and 0 <= rd["score"] <= 100
        assert any(c["key"] == "sleep_hours" for c in rd["components"])
