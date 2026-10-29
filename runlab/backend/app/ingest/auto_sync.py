"""Daily automatic Garmin sync.

Runs inside the background service only (RUNLAB_SUPERVISED=1), so a dev or verification
server pointed at the same database never syncs twice. Once a day at the chosen time it starts
the normal incremental sync; if the PC was off or asleep at that time, it catches up as soon as
it's back. A failed run is retried hourly, at most MAX_ATTEMPTS times a day.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlmodel import Session

from app.db import engine
from app.ingest.garmin_auth import garmin_auth
from app.ingest.garmin_sync import _set_state, get_state, sync_manager

log = logging.getLogger(__name__)

CONFIG_KEY = "auto_sync"
LAST_KEY = "auto_sync_last"
DEFAULT = {"enabled": True, "time": "08:00"}
MAX_ATTEMPTS = 3
RETRY_AFTER = timedelta(hours=1)
TICK_SECONDS = 60


def config(session: Session) -> dict[str, Any]:
    try:
        raw = json.loads(get_state(session, CONFIG_KEY) or "{}")
    except ValueError:
        raw = {}
    cfg = {**DEFAULT, **{k: v for k, v in raw.items() if k in DEFAULT}}
    try:
        time.fromisoformat(cfg["time"])
    except (TypeError, ValueError):
        cfg["time"] = DEFAULT["time"]
    return cfg


def set_config(session: Session, enabled: bool, at: str) -> dict[str, Any]:
    t = time.fromisoformat(at)  # raises ValueError for a bad time
    _set_state(session, CONFIG_KEY, json.dumps({"enabled": enabled, "time": t.strftime("%H:%M")}))
    return config(session)


def last_run(session: Session) -> dict[str, Any] | None:
    try:
        return json.loads(get_state(session, LAST_KEY) or "null")
    except ValueError:
        return None


def _save_last(session: Session, rec: dict[str, Any]) -> None:
    _set_state(session, LAST_KEY, json.dumps(rec, ensure_ascii=False))


def due_at(cfg: dict[str, Any], day: date) -> datetime:
    return datetime.combine(day, time.fromisoformat(cfg["time"]))


def should_run(cfg: dict[str, Any], last: dict[str, Any] | None, now: datetime) -> bool:
    """Today's run is due once the time has passed, unless today already succeeded or ran out of retries."""
    if not cfg["enabled"] or now < due_at(cfg, now.date()):
        return False
    if not last or last.get("day") != now.date().isoformat():
        return True
    if last.get("running") or last.get("ok"):
        return False
    if last.get("attempts", 0) >= MAX_ATTEMPTS:
        return False
    started = datetime.fromisoformat(last["started_at"])
    return now - started >= RETRY_AFTER


def next_run(cfg: dict[str, Any], last: dict[str, Any] | None, now: datetime) -> str | None:
    if not cfg["enabled"]:
        return None
    if should_run(cfg, last, now):
        return now.isoformat(timespec="minutes")
    today = due_at(cfg, now.date())
    if now < today:
        return today.isoformat(timespec="minutes")
    if last and last.get("day") == now.date().isoformat() and not last.get("ok") and not last.get("running") \
            and last.get("attempts", 0) < MAX_ATTEMPTS:
        return (datetime.fromisoformat(last["started_at"]) + RETRY_AFTER).isoformat(timespec="minutes")
    return due_at(cfg, now.date() + timedelta(days=1)).isoformat(timespec="minutes")


def tick(now: datetime | None = None) -> str:
    """One scheduler step. Returns what it did (for logs and tests)."""
    now = now or datetime.now()
    with Session(engine) as session:
        cfg, last = config(session), last_run(session)

        # A run we started has finished: record how it went.
        if last and last.get("running") and not sync_manager.snapshot()["running"]:
            snap = sync_manager.snapshot()
            last.update(
                running=False, ok=snap["phase"] == "done", finished_at=snap["finished_at"],
                new_activities=snap["new_activities"], new_wellness_days=snap["new_wellness_days"],
                error=snap["error"],
            )
            _save_last(session, last)
            return "recorded"

        if not should_run(cfg, last, now):
            return "idle"
        if not garmin_auth.status().connected:
            return "not-connected"
        if not sync_manager.start(full=False):
            return "busy"  # a manual sync is running; try again next tick
        attempts = (last.get("attempts", 0) if last and last.get("day") == now.date().isoformat() else 0) + 1
        _save_last(session, {"day": now.date().isoformat(), "started_at": now.isoformat(timespec="seconds"),
                             "attempts": attempts, "running": True})
        log.info("auto sync started (attempt %s)", attempts)
        return "started"


def status(session: Session, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now()
    cfg, last = config(session), last_run(session)
    return {**cfg, "active": enabled_here(), "last": last, "next_run": next_run(cfg, last, now)}


def enabled_here() -> bool:
    return os.environ.get("RUNLAB_SUPERVISED") == "1" and os.environ.get("RUNLAB_DISABLE_SCHEDULER") != "1"


def start_scheduler() -> threading.Thread | None:
    if not enabled_here():
        return None
    stop = threading.Event()

    def loop() -> None:
        stop.wait(20)  # let startup work (resume / recompute) claim the job slot first
        while not stop.is_set():
            try:
                tick()
            except Exception:
                log.exception("auto sync tick failed")
            stop.wait(TICK_SECONDS)

    t = threading.Thread(target=loop, daemon=True, name="auto-sync")
    t.start()
    return t
