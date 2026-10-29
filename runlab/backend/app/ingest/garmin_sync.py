"""Background sync job: activities → FIT streams → wellness → weather."""

from __future__ import annotations

import json
import logging
import threading
import time
from collections import deque
from collections.abc import Callable
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
from garminconnect import Garmin, GarminConnectTooManyRequestsError
from sqlmodel import Session, func, select

from app.analytics.metrics import recompute
from app.db import engine
from app.ingest.fit_parser import (
    NotAnActivityError,
    is_running,
    iter_fit_files,
    iter_fit_payloads,
    parse_fit,
)
from app.ingest.garmin_auth import garmin_auth
from app.ingest.store import save_activity
from app.ingest.weather import fetch_weather
from app.models import Activity, DailyWellness, SyncState

log = logging.getLogger(__name__)

PAGE_SIZE = 100
ACTIVE_JOB_KEY = "active_sync_job"
REQUEST_GAP_S = 0.35


def _parse_dt(v: str | None) -> datetime | None:
    if not v:
        return None
    try:
        return datetime.fromisoformat(v.replace("Z", ""))
    except ValueError:
        return None


def summary_from_garmin(a: dict[str, Any]) -> dict[str, Any]:
    cadence = a.get("averageRunningCadenceInStepsPerMinute")
    return {
        "garmin_id": a.get("activityId"),
        "source": "garmin",
        "name": a.get("activityName"),
        "sport": (a.get("activityType") or {}).get("typeKey") or "other",
        "start_time": _parse_dt(a.get("startTimeLocal")),
        "start_time_utc": _parse_dt(a.get("startTimeGMT")),
        "distance_m": a.get("distance") or 0,
        "duration_s": a.get("duration") or 0,
        "moving_time_s": a.get("movingDuration"),
        "elevation_gain_m": a.get("elevationGain"),
        "avg_hr": a.get("averageHR"),
        "max_hr": a.get("maxHR"),
        "avg_speed_mps": a.get("averageSpeed"),
        "avg_cadence": cadence,
        "calories": a.get("calories"),
        "start_lat": a.get("startLatitude"),
        "start_lon": a.get("startLongitude"),
        "aerobic_te": a.get("aerobicTrainingEffect"),
        "anaerobic_te": a.get("anaerobicTrainingEffect"),
        "vo2max": a.get("vO2MaxValue"),
    }


def _get(d: Any, *path: str) -> Any:
    for p in path:
        if not isinstance(d, dict):
            return None
        d = d.get(p)
    return d


class SyncManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self.state: dict[str, Any] = self._idle_state()
        self._log: deque[str] = deque(maxlen=60)

    @staticmethod
    def _idle_state() -> dict[str, Any]:
        return {
            "running": False, "phase": "idle", "current": 0, "total": 0,
            "message": "", "error": None, "new_activities": 0, "new_wellness_days": 0,
            "started_at": None, "finished_at": None,
        }

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {**self.state, "log": list(self._log)}

    def _set(self, **kw: Any) -> None:
        with self._lock:
            self.state.update(kw)
            if msg := kw.get("message"):
                self._log.append(f"{datetime.now():%H:%M:%S}  {msg}")

    def _bump(self, key: str) -> None:
        with self._lock:
            self.state[key] += 1

    def _launch(self, target: Callable[..., None], *args: Any) -> bool:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return False
            self.state = self._idle_state()
            self.state.update(running=True, phase="starting", started_at=datetime.now().isoformat())
            self._log.clear()
            self._thread = threading.Thread(target=target, args=args, daemon=True, name="runlab-job")
            self._thread.start()
            return True

    def start(self, full: bool = False, wellness_days: int = 180) -> bool:
        started = self._launch(self._run, full, wellness_days)
        if started:
            with Session(engine) as session:
                _set_state(session, ACTIVE_JOB_KEY, json.dumps({"full": full, "wellness_days": wellness_days}))
        return started

    def start_recompute(self, force: bool = False) -> bool:
        return self._launch(self._run_recompute, force)

    def _run_recompute(self, force: bool) -> None:
        try:
            with Session(engine) as session:
                self._analyze(session, force)
            self._set(phase="done", message="분석 완료")
        except Exception as e:
            log.exception("recompute failed")
            self._set(phase="error", error=str(e) or type(e).__name__, message=f"오류: {e}")
        finally:
            self._set(running=False, finished_at=datetime.now().isoformat())

    def _analyze(self, session: Session, force: bool = False) -> None:
        self._set(phase="analysis", current=0, total=0, message="훈련 부하·지표 계산 중")
        n = recompute(session, force=force, progress=lambda i, total: self._set(current=i, total=total))
        self._set(message=f"활동 {n}개 분석")
        try:
            from app.analytics.snapshots import record

            record(session)  # today's fitness / predictions / goal outlook, for history
        except Exception:
            log.exception("snapshot failed")

    def start_import(self, paths: list[Path]) -> bool:
        return self._launch(self._run_import, paths)

    def _run_import(self, paths: list[Path]) -> None:
        try:
            self._set(phase="import", message="파일 분석 중")
            total = 0
            for p in paths:
                total += sum(1 for _ in iter_fit_files(p))
            self._set(total=total, current=0, message=f"FIT 파일 {total}개 발견")
            skipped = 0
            with Session(engine) as session:
                i = 0
                for p in paths:
                    for name, payload in iter_fit_files(p):
                        i += 1
                        try:
                            parsed = parse_fit(payload)
                            summary = {**parsed.summary, "source": "fit_upload", "name": Path(name).stem}
                            _, created = save_activity(session, summary, parsed.laps, parsed.stream)
                            if created:
                                self._bump("new_activities")
                        except NotAnActivityError:
                            skipped += 1
                        except Exception as e:
                            session.rollback()
                            self._set(message=f"{Path(name).name}: 파싱 실패 ({e})")
                        self._set(current=i)
                self._enrich_weather(session)
                self._analyze(session)
            self._set(phase="done", message=f"가져오기 완료 · 활동이 아닌 파일 {skipped}개 건너뜀")
        except Exception as e:
            log.exception("import failed")
            self._set(phase="error", error=str(e) or type(e).__name__, message=f"오류: {e}")
        finally:
            for p in paths:
                p.unlink(missing_ok=True)
            self._set(running=False, finished_at=datetime.now().isoformat())

    # ── job ────────────────────────────────────────────────────────────
    def _run(self, full: bool, wellness_days: int) -> None:
        try:
            g = garmin_auth.client()
            with Session(engine) as session:
                self._sync_activities(g, session, full)
                self._sync_wellness(g, session, wellness_days)
                self._enrich_weather(session)
                self._analyze(session)
                _set_state(session, "last_sync", datetime.now().isoformat())
            self._set(phase="done", message="동기화 완료")
        except Exception as e:  # surface any failure to the UI
            log.exception("sync failed")
            self._set(phase="error", error=str(e) or type(e).__name__, message=f"오류: {e}")
        finally:
            # Only a run that reaches here (not a killed process) clears the resume marker.
            with Session(engine) as session:
                _clear_state(session, ACTIVE_JOB_KEY)
            self._set(running=False, finished_at=datetime.now().isoformat())

    def _call(self, fn: Callable[..., Any], *args: Any, **kw: Any) -> Any:
        for attempt in range(4):
            try:
                out = fn(*args, **kw)
                time.sleep(REQUEST_GAP_S)
                return out
            except GarminConnectTooManyRequestsError:
                wait = 30 * (attempt + 1)
                self._set(message=f"요청 한도 도달 — {wait}초 대기")
                time.sleep(wait)
        raise RuntimeError("가민 요청 한도 초과가 계속됩니다. 나중에 다시 시도하세요.")

    def _sync_activities(self, g: Garmin, session: Session, full: bool) -> None:
        self._set(phase="activities", message="활동 목록 확인 중")
        known = {
            gid for gid in session.exec(select(Activity.garmin_id).where(Activity.garmin_id.is_not(None)))
        }
        with_stream = {
            gid for gid in session.exec(
                select(Activity.garmin_id).where(Activity.has_stream.is_(True), Activity.garmin_id.is_not(None))
            )
        }
        todo: list[dict[str, Any]] = []
        start = 0
        while True:
            page = self._call(g.get_activities, start, PAGE_SIZE) or []
            hit_known = False
            for a in page:
                gid = a.get("activityId")
                if gid in known:
                    hit_known = True
                    needs_stream = is_running(_get(a, "activityType", "typeKey")) and gid not in with_stream
                    if full and needs_stream:
                        todo.append(a)
                else:
                    todo.append(a)
            self._set(message=f"활동 목록 {start + len(page)}개 확인 · 새 항목 {len(todo)}개")
            if len(page) < PAGE_SIZE or (hit_known and not full):
                break
            start += PAGE_SIZE

        todo.reverse()  # oldest first so partial runs still leave a coherent history
        self._set(phase="streams", current=0, total=len(todo))
        for i, a in enumerate(todo, 1):
            summary = summary_from_garmin(a)
            laps, stream = None, None
            if is_running(summary["sport"]):
                try:
                    raw = self._call(g.download_activity, a["activityId"], dl_fmt=Garmin.ActivityDownloadFormat.ORIGINAL)
                    for _name, payload in iter_fit_payloads(f"{a['activityId']}.zip", raw):
                        parsed = parse_fit(payload)
                        laps, stream = parsed.laps, parsed.stream
                        for k, v in parsed.summary.items():
                            if summary.get(k) in (None, 0):
                                summary[k] = v
                        break
                except NotAnActivityError:
                    pass
                except Exception as e:
                    self._set(message=f"FIT 다운로드 실패 ({a.get('activityName')}): {e}")
            _, created = save_activity(session, summary, laps, stream)
            if created:
                self._bump("new_activities")
            label = summary.get("start_time").strftime("%Y-%m-%d") if summary.get("start_time") else ""
            self._set(current=i, message=f"{label} {summary.get('name') or ''}".strip())

    def _sync_wellness(self, g: Garmin, session: Session, backfill_days: int) -> None:
        last = session.exec(select(func.max(DailyWellness.day))).one()
        today = date.today()
        # Re-fetch the last 2 stored days: sleep/HRV for "today" finalize later.
        first = (last - timedelta(days=2)) if last else today - timedelta(days=backfill_days)
        days = [first + timedelta(days=i) for i in range((today - first).days + 1)]
        self._set(phase="wellness", current=0, total=len(days), message=f"웰니스 {len(days)}일 수집")

        weights: dict[str, float] = {}
        try:
            comp = self._call(g.get_body_composition, first.isoformat(), today.isoformat()) or {}
            for w in comp.get("dateWeightList") or []:
                if w.get("calendarDate") and w.get("weight"):
                    weights[w["calendarDate"]] = w["weight"] / 1000
        except Exception as e:
            self._set(message=f"체중 데이터 건너뜀: {e}")

        for i, d in enumerate(days, 1):
            ds = d.isoformat()
            row = session.get(DailyWellness, d) or DailyWellness(day=d)
            is_new = row.resting_hr is None and row.sleep_total_s is None
            try:
                us = self._call(g.get_user_summary, ds) or {}
                row.resting_hr = us.get("restingHeartRate") or row.resting_hr
                row.steps = us.get("totalSteps") or row.steps
                row.stress_avg = us.get("averageStressLevel") if (us.get("averageStressLevel") or -1) >= 0 else row.stress_avg
                row.body_battery_max = us.get("bodyBatteryHighestValue") or row.body_battery_max
                row.body_battery_min = us.get("bodyBatteryLowestValue") or row.body_battery_min

                sl = self._call(g.get_sleep_data, ds) or {}
                dto = sl.get("dailySleepDTO") or {}
                row.sleep_total_s = dto.get("sleepTimeSeconds") or row.sleep_total_s
                row.sleep_deep_s = dto.get("deepSleepSeconds") or row.sleep_deep_s
                row.sleep_rem_s = dto.get("remSleepSeconds") or row.sleep_rem_s
                row.sleep_score = _get(dto, "sleepScores", "overall", "value") or row.sleep_score

                hrv = self._call(g.get_hrv_data, ds) or {}
                row.hrv_avg = _get(hrv, "hrvSummary", "lastNightAvg") or row.hrv_avg
                row.hrv_status = _get(hrv, "hrvSummary", "status") or row.hrv_status

                tr = self._call(g.get_training_readiness, ds) or []
                if isinstance(tr, list) and tr:
                    row.training_readiness = max((t.get("score") or 0) for t in tr) or row.training_readiness
            except RuntimeError:
                raise
            except Exception as e:
                self._set(message=f"{ds} 웰니스 일부 실패: {e}")
            if ds in weights:
                row.weight_kg = weights[ds]
            session.add(row)
            session.commit()
            if is_new and (row.resting_hr or row.sleep_total_s):
                self._bump("new_wellness_days")
            self._set(current=i, message=f"웰니스 {ds}")

    def _enrich_weather(self, session: Session) -> None:
        rows = session.exec(
            select(Activity).where(
                Activity.weather.is_(None),
                Activity.start_lat.is_not(None),
                Activity.start_time_utc.is_not(None),
                Activity.sport.contains("run"),
            )
        ).all()
        rows = [r for r in rows if "treadmill" not in r.sport and "indoor" not in r.sport]
        if not rows:
            return
        self._set(phase="weather", current=0, total=len(rows), message=f"날씨 {len(rows)}건 보강")
        with httpx.Client() as client:
            for i, act in enumerate(rows, 1):
                try:
                    act.weather = fetch_weather(act.start_lat, act.start_lon, act.start_time_utc, client) or {}
                    session.add(act)
                    session.commit()
                except Exception as e:
                    self._set(message=f"날씨 조회 실패: {e}")
                    session.rollback()
                self._set(current=i)
                time.sleep(0.1)


def _set_state(session: Session, key: str, value: str) -> None:
    row = session.get(SyncState, key) or SyncState(key=key)
    row.value = value
    row.updated_at = datetime.now()
    session.add(row)
    session.commit()


def _clear_state(session: Session, key: str) -> None:
    row = session.get(SyncState, key)
    if row:
        session.delete(row)
        session.commit()


def resume_interrupted(session: Session) -> bool:
    """Restart a sync that was cut off by a process restart (e.g. dev-server reload)."""
    raw = get_state(session, ACTIVE_JOB_KEY)
    if not raw:
        return False
    if not garmin_auth.status().connected:
        _clear_state(session, ACTIVE_JOB_KEY)
        return False
    params = json.loads(raw)
    log.info("resuming interrupted sync %s", params)
    return sync_manager.start(full=bool(params.get("full")), wellness_days=int(params.get("wellness_days", 180)))


def get_state(session: Session, key: str) -> str | None:
    row = session.get(SyncState, key)
    return row.value if row else None


sync_manager = SyncManager()
