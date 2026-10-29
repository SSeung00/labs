"""EnglishLab background service — runs the server with no console window.

    pythonw englishlab-service.pyw            start in the background (used at Windows log-in)
    pythonw englishlab-service.pyw --open     start if needed, then open the app window
    pythonw englishlab-service.pyw --stop     stop the service and the server
    pythonw englishlab-service.pyw --restart  restart the server (e.g. after an update)
    pythonw englishlab-service.pyw --install  start at log-in + Start-menu/desktop "EnglishLab" icons, then open
    pythonw englishlab-service.pyw --uninstall  stop starting at log-in

On Linux run it with backend/.venv/bin/python instead of pythonw: --install there sets up a
systemd user service (englishlab.service) and an app-menu launcher; the *.sh scripts wrap the same commands.

What it does while running:
- keeps one uvicorn on 127.0.0.1:8005 alive (restarts it if it exits, with back-off);
- rebuilds the web app when files under frontend/ change, so phones get the new version
  the next time they open EnglishLab;
- restarts the server when backend code changes;
- listens on 127.0.0.1:8095 for stop/restart/status commands (also the single-instance lock).
Logs go to data/logs/.
"""

from __future__ import annotations

import os
import shutil
import signal
import socket
import socketserver
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
WINDOWS = sys.platform == "win32"
PYTHON = BACKEND / ".venv" / ("Scripts/python.exe" if WINDOWS else "bin/python")
LOG_DIR = ROOT / "data" / "logs"
PORT = 8005
CONTROL_PORT = 8095
# Edge names an app window's taskbar entry after the host (the port is ignored), so each app gets
# its own *.localhost host to show up as its own taskbar icon. desktop.APP_ID must match.
URL = f"http://englishlab.localhost:{PORT}"
# Linux: Chromium-family browsers, tried in order; --class names the window after the launcher.
LINUX_BROWSERS = ("microsoft-edge", "microsoft-edge-stable", "google-chrome", "google-chrome-stable",
                  "chromium", "chromium-browser", "brave-browser")
APP_CLASS = "EnglishLab"
NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0

FRONTEND_INPUTS = [FRONTEND / "src", FRONTEND / "public", FRONTEND / "index.html", FRONTEND / "vite.config.ts"]
BACKEND_INPUTS = [BACKEND / "app"]
QUIET_SECONDS_BUILD = 15  # wait until edits settle before rebuilding
QUIET_SECONDS_RESTART = 4
MAX_LOG_BYTES = 5_000_000
KEEP_OLD_ASSETS_DAYS = 7


# ---------- small helpers ----------

def log(msg: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    path = LOG_DIR / "service.log"
    if path.exists() and path.stat().st_size > MAX_LOG_BYTES:
        path.replace(path.with_suffix(".old.log"))
    with path.open("a", encoding="utf-8") as f:
        f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")


def newest_mtime(paths: list[Path], suffixes: tuple[str, ...] | None = None) -> float:
    newest = 0.0
    for p in paths:
        if p.is_file():
            newest = max(newest, p.stat().st_mtime)
            continue
        if not p.exists():
            continue
        for f in p.rglob("*"):
            if f.is_file() and "__pycache__" not in f.parts and (suffixes is None or f.suffix in suffixes):
                newest = max(newest, f.stat().st_mtime)
    return newest


def port_open(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def healthy(timeout: float = 2.0) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/health", timeout=timeout) as r:
            return r.status == 200
    except OSError:
        return False


def send(command: str) -> str | None:
    """Send a command to a running service; None if none is running."""
    try:
        with socket.create_connection(("127.0.0.1", CONTROL_PORT), timeout=3) as s:
            s.sendall(command.encode() + b"\n")
            return s.recv(1024).decode().strip()
    except OSError:
        return None


def open_window() -> None:
    """The app in its own window (no tabs/address bar), like an installed program."""
    if not WINDOWS:
        for name in LINUX_BROWSERS:
            if exe := shutil.which(name):
                subprocess.Popen([exe, f"--app={URL}", f"--class={APP_CLASS}"], start_new_session=True,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return
        webbrowser.open(URL)
        return
    for browser in (
        Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe",
        Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Microsoft/Edge/Application/msedge.exe",
        Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Google/Chrome/Application/chrome.exe",
    ):
        if browser.exists():
            subprocess.Popen([str(browser), f"--app={URL}"], creationflags=NO_WINDOW)
            return
    webbrowser.open(URL)


# ---------- the supervisor ----------

class Service:
    def __init__(self) -> None:
        self.proc: subprocess.Popen | None = None
        self.stop = threading.Event()
        self.restart = threading.Event()
        self.rebuild = threading.Event()
        self.lock = threading.Lock()
        self.backend_mtime = newest_mtime(BACKEND_INPUTS, (".py",))
        self.frontend_seen = newest_mtime(FRONTEND_INPUTS)
        self.failures = 0
        self.started_at = 0.0
        self.last_build: str | None = None

    # -- web app build --
    def dist_stale(self) -> bool:
        index = FRONTEND / "dist" / "index.html"
        return not index.exists() or newest_mtime(FRONTEND_INPUTS) > index.stat().st_mtime

    def build(self) -> bool:
        """Build into dist-next, carry over recent old bundles, then swap it in as dist.

        The live dist is never half-written, and a phone still running the previous build can
        keep loading its lazy chunks (hashed names never collide) for KEEP_OLD_ASSETS_DAYS.
        """
        if WINDOWS:
            npm = Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "nodejs" / "npm.cmd"
            npm_cmd = str(npm) if npm.exists() else "npm.cmd"
        else:
            npm_cmd = shutil.which("npm") or "npm"
        cmd = [npm_cmd, "run", "build", "--", "--outDir", "dist-next"]
        nxt, live, old = FRONTEND / "dist-next", FRONTEND / "dist", FRONTEND / "dist-old"
        log("building web app…")
        with (LOG_DIR / "build.log").open("w", encoding="utf-8") as out:
            try:
                r = subprocess.run(cmd, cwd=FRONTEND, stdout=out, stderr=subprocess.STDOUT,
                                   creationflags=NO_WINDOW, timeout=900, check=False)
            except (OSError, subprocess.TimeoutExpired) as e:
                log(f"build failed to run: {e}")
                return False
        if r.returncode != 0 or not (nxt / "index.html").exists():
            log(f"build FAILED (exit {r.returncode}) — keeping the previous version, see build.log")
            shutil.rmtree(nxt, ignore_errors=True)
            return False
        cutoff = time.time() - KEEP_OLD_ASSETS_DAYS * 86400
        if (live / "assets").is_dir():
            for f in (live / "assets").iterdir():
                target = nxt / "assets" / f.name
                if f.is_file() and not target.exists() and f.stat().st_mtime >= cutoff:
                    shutil.copy2(f, target)
        shutil.rmtree(old, ignore_errors=True)
        for _ in range(20):  # a file being served can block the rename for a moment
            try:
                if live.exists():
                    live.rename(old)
                nxt.rename(live)
                break
            except OSError:
                time.sleep(0.5)
        else:
            log("could not swap in the new build (files busy) — will retry on the next change")
            return False
        shutil.rmtree(old, ignore_errors=True)
        self.last_build = datetime.now().isoformat(timespec="seconds")
        log("build ok")
        return True

    # -- server process --
    def start_server(self) -> None:
        if port_open(PORT):
            log(f"port {PORT} is busy (another EnglishLab window?) — waiting")
            return
        out = (LOG_DIR / "server.log")
        if out.exists() and out.stat().st_size > MAX_LOG_BYTES:
            out.replace(out.with_suffix(".old.log"))
        f = out.open("a", encoding="utf-8")
        env = {**os.environ, "ENGLISHLAB_SUPERVISED": "1", "PYTHONUNBUFFERED": "1"}
        self.proc = subprocess.Popen(
            [str(PYTHON), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(PORT),
             "--timeout-graceful-shutdown", "2"],
            cwd=BACKEND, stdout=f, stderr=subprocess.STDOUT, creationflags=NO_WINDOW, env=env,
        )
        self.started_at = time.monotonic()
        log(f"server started (pid {self.proc.pid})")

    def stop_server(self) -> None:
        p, self.proc = self.proc, None
        if p and p.poll() is None:
            p.terminate()
            try:
                p.wait(10)
            except subprocess.TimeoutExpired:
                p.kill()
            # The venv launcher exits first; give the interpreter behind it a moment to free the port.
            for _ in range(40):
                if not port_open(PORT):
                    break
                time.sleep(0.25)
            log("server stopped")

    # -- main loop --
    def run(self) -> None:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        log("service starting")
        if self.dist_stale():
            self.build()
        self.start_server()
        pending_front = pending_back = 0.0
        while not self.stop.wait(2):
            with self.lock:
                now = time.monotonic()
                # Server exited on its own: bring it back, backing off if it keeps crashing.
                if self.proc is not None and self.proc.poll() is not None:
                    code = self.proc.returncode
                    self.proc = None
                    quick = now - self.started_at < 30
                    self.failures = self.failures + 1 if quick else 0
                    delay = min(60, 2 ** self.failures)
                    log(f"server exited with {code}; restarting in {delay}s")
                    if self.stop.wait(delay):
                        break
                    self.start_server()
                elif self.proc is None and not port_open(PORT):
                    self.start_server()

                # Backend code changed → restart once edits settle.
                m = newest_mtime(BACKEND_INPUTS, (".py",))
                if m > self.backend_mtime:
                    self.backend_mtime = m
                    pending_back = now
                if pending_back and now - pending_back >= QUIET_SECONDS_RESTART:
                    pending_back = 0.0
                    log("backend code changed")
                    self.restart.set()

                # Front-end sources changed → rebuild once edits settle (no restart needed).
                fm = newest_mtime(FRONTEND_INPUTS)
                if fm > self.frontend_seen:
                    self.frontend_seen = fm
                    pending_front = now
                if (pending_front and now - pending_front >= QUIET_SECONDS_BUILD) or self.rebuild.is_set():
                    pending_front = 0.0
                    self.rebuild.clear()
                    if self.dist_stale():
                        self.build()

                if self.restart.is_set():
                    self.restart.clear()
                    self.failures = 0
                    self.stop_server()
                    self.start_server()
        self.stop_server()
        log("service stopped")

    def status(self) -> str:
        running = self.proc is not None and self.proc.poll() is None
        return f"ok server={'up' if running else 'down'} build={self.last_build or '-'}"


def serve_control(service: Service, sock: socket.socket) -> None:
    class Handler(socketserver.StreamRequestHandler):
        def handle(self) -> None:
            cmd = self.rfile.readline().decode().strip()
            if cmd == "stop":
                self.wfile.write(b"stopping\n")
                service.stop.set()
            elif cmd == "restart":
                self.wfile.write(b"restarting\n")
                service.restart.set()
            elif cmd == "rebuild":
                self.wfile.write(b"rebuilding\n")
                service.rebuild.set()
            else:
                self.wfile.write((service.status() + "\n").encode())

    server = socketserver.TCPServer(("127.0.0.1", CONTROL_PORT), Handler, bind_and_activate=False)
    server.socket.close()
    server.socket = sock
    server.serve_forever(poll_interval=0.5)


def install(enable: bool) -> None:
    """Per-user shortcuts, shared with Settings -> PC app (backend/app/desktop.py)."""
    sys.path.insert(0, str(BACKEND))
    from app import desktop  # imported late: needs the backend on sys.path first

    desktop.set_autostart(enable)
    if enable:
        desktop.make_app_shortcuts()
        # Linux: systemd runs the service from now on; wait until it holds the control port.
        if not WINDOWS and desktop.start_service():
            for _ in range(40):
                if send("status") is not None:
                    break
                time.sleep(0.25)
    log("autostart " + ("installed" if enable else "removed"))


def main(argv: list[str]) -> None:
    if "--install" in argv:
        install(True)
        argv = [*argv, "--open"]
    if "--uninstall" in argv:
        install(False)
        return
    if "--stop" in argv:
        send("stop")
        return
    if "--restart" in argv:
        if send("restart") is None:
            argv = [*argv, "--start"]
        else:
            return

    # Single instance: whoever holds the control port is the service.
    sock = socket.socket()
    try:
        sock.bind(("127.0.0.1", CONTROL_PORT))
        sock.listen(5)
    except OSError:
        sock.close()
        if "--open" in argv:
            for _ in range(240):  # a service that just started may still be building
                if healthy():
                    break
                time.sleep(0.5)
            open_window()
        return

    service = Service()
    if not WINDOWS:  # systemctl stop: shut the server down cleanly instead of dying mid-request
        signal.signal(signal.SIGTERM, lambda *_: service.stop.set())
    threading.Thread(target=serve_control, args=(service, sock), daemon=True).start()
    if "--open" in argv:
        def opener() -> None:
            for _ in range(240):  # first start may need a build (~1 min)
                if healthy():
                    open_window()
                    return
                time.sleep(0.5)
            log("server did not come up; not opening the window")
        threading.Thread(target=opener, daemon=True).start()
    try:
        service.run()
    except Exception as e:  # never die silently in the background
        log(f"service crashed: {type(e).__name__}: {e}")
        service.stop_server()
        raise


if __name__ == "__main__":
    main(sys.argv[1:])
