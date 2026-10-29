from fastapi.testclient import TestClient

from app import auth
from app.main import app

PHONE = "http://my-pc.tail1234.ts.net"


def test_remote_locked_until_pin_and_cookie():
    auth.reset_failures()
    with TestClient(app) as pc, TestClient(app, base_url=PHONE) as phone:
        pc.put("/api/auth/pin", json={"pin": None})

        # No PIN yet: remote API is closed, but the unlock screen can ask why.
        r = phone.get("/api/activities")
        assert r.status_code == 403 and r.json()["code"] == "pin_not_set"
        assert phone.get("/api/auth/status").json() == {
            "local": False, "pin_set": False, "authed": False, "retry_after": 0,
        }

        # Only the PC can set the PIN.
        assert phone.put("/api/auth/pin", json={"pin": "123456"}).status_code == 403
        assert pc.put("/api/auth/pin", json={"pin": "12"}).status_code == 422
        assert pc.put("/api/auth/pin", json={"pin": "123456"}).json() == {"pin_set": True}

        assert phone.get("/api/activities").status_code == 401
        assert phone.post("/api/auth/unlock", json={"pin": "000000"}).status_code == 401
        assert phone.post("/api/auth/unlock", json={"pin": "123456"}).status_code == 200
        assert phone.get("/api/activities").status_code == 200
        assert phone.get("/api/auth/status").json()["authed"] is True

        # Changing the PIN signs every device out.
        pc.put("/api/auth/pin", json={"pin": "654321"})
        assert phone.get("/api/activities").status_code == 401

        # The PC itself never needs the PIN.
        assert pc.get("/api/activities").status_code == 200
        pc.put("/api/auth/pin", json={"pin": None})


def test_unlock_rate_limited():
    auth.reset_failures()
    with TestClient(app) as pc, TestClient(app, base_url=PHONE) as phone:
        pc.put("/api/auth/pin", json={"pin": "2468"})
        for _ in range(auth.MAX_FAILS):
            phone.post("/api/auth/unlock", json={"pin": "0000"})
        r = phone.post("/api/auth/unlock", json={"pin": "2468"})
        assert r.status_code == 429
        pc.put("/api/auth/pin", json={"pin": None})
    auth.reset_failures()


def test_proxied_loopback_is_remote():
    # tailscale serve connects from loopback but adds forwarding headers / keeps the ts.net host.
    scope = {"client": ("127.0.0.1", 5000), "headers": [(b"host", b"localhost:8000")]}
    assert auth.is_local(scope)
    assert auth.is_local({**scope, "headers": [(b"host", b"runlab.localhost:8000")]})
    assert not auth.is_local({"client": ("100.64.0.5", 5000), "headers": [(b"host", b"runlab.localhost:8000")]})
    assert not auth.is_local({**scope, "headers": [(b"host", b"runlab.localhost.evil.com")]})
    assert not auth.is_local({**scope, "headers": [(b"host", b"my-pc.tail1234.ts.net")]})
    assert not auth.is_local({**scope, "headers": [(b"host", b"localhost:8000"), (b"x-forwarded-for", b"100.1.2.3")]})
    assert not auth.is_local({"client": ("100.64.0.5", 5000), "headers": [(b"host", b"localhost")]})


def test_spa_fallback_and_api_404():
    with TestClient(app) as pc:
        assert pc.get("/api/does-not-exist").status_code == 404
        r = pc.get("/plan")
        assert r.status_code in (200, 404)  # 404 only when the web app isn't built
        if r.status_code == 200:
            assert "text/html" in r.headers["content-type"]


def test_remote_status_shape():
    with TestClient(app) as pc:
        body = pc.get("/api/remote/status").json()
    assert {"installed", "running", "url", "serving", "serve_cmd", "pin_set"} <= body.keys()


def test_tailscale_json_is_read_as_utf8(monkeypatch, tmp_path):
    # Real `tailscale status --json` contains non-ASCII text; reading it with the
    # Windows default code page used to crash the status endpoint.
    import sys

    from app.routers import remote

    script = tmp_path / "fake_ts.py"
    script.write_text(
        "import sys\nsys.stdout.buffer.write('{\"Self\": {\"HostName\": \"한글-pc\"}}'.encode('utf-8'))\n",
        encoding="utf-8",
    )
    bat = tmp_path / "fake_ts.bat"
    bat.write_text(f'@"{sys.executable}" "{script}"\n', encoding="utf-8")
    exe = str(bat) if sys.platform == "win32" else None
    if exe is None:
        return
    assert remote._run(exe, "status") == {"Self": {"HostName": "한글-pc"}}


def test_missing_asset_is_404_not_html():
    with TestClient(app) as pc:
        assert pc.get("/assets/does-not-exist.js").status_code == 404


def test_qr_svg_scales_instead_of_cropping():
    from app.routers.remote import _qr_svg

    svg = _qr_svg("https://my-pc.tail1234.ts.net")
    head = svg[: svg.index(">")]
    assert "viewBox" in head and "width=" not in head and "height=" not in head
