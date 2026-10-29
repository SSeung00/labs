from fastapi.testclient import TestClient

from app import desktop
from app.main import app

PHONE = "http://my-pc.tail1234.ts.net"


def test_service_status_shape():
    with TestClient(app) as c:
        st = c.get("/api/system/service").json()
    assert {"supervised", "service", "autostart", "shortcuts", "build", "windows"} <= st.keys()


def test_restart_needs_the_service(monkeypatch):
    monkeypatch.setattr(desktop, "control", lambda cmd: None)
    with TestClient(app) as c:
        assert c.post("/api/system/restart").status_code == 400


def test_restart_sends_command(monkeypatch):
    sent = []
    monkeypatch.setattr(desktop, "control", lambda cmd: sent.append(cmd) or "ok")
    monkeypatch.setattr("app.routers.system.threading.Timer", lambda _t, fn, args: type("T", (), {"start": lambda self: fn(*args)})())
    with TestClient(app) as c:
        assert c.post("/api/system/restart").json() == {"ok": True}
    assert sent[-1] == "restart"


def test_pc_settings_are_local_only(monkeypatch):
    monkeypatch.setattr(desktop, "set_autostart", lambda enabled: (_ for _ in ()).throw(AssertionError("must not run")))
    from app import auth

    with TestClient(app) as pc, TestClient(app, base_url=PHONE) as phone:
        pc.put("/api/auth/pin", json={"pin": "1357"})
        phone.post("/api/auth/unlock", json={"pin": "1357"})
        assert phone.put("/api/system/autostart", json={"enabled": True}).status_code == 403
        assert phone.post("/api/system/restart").status_code == 403
        pc.put("/api/auth/pin", json={"pin": None})
    auth.reset_failures()
