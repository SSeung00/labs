"""Parse FIT activity files into a summary, laps and a per-second stream.

Field names follow the FIT SDK profile as exposed by fitdecode. Units are kept
in SI (m, s, m/s) except where noted in STREAM_COLUMNS.
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import fitdecode
import pandas as pd

SEMICIRCLE_TO_DEG = 180.0 / 2**31

# Stream columns written to Parquet.
#   t: seconds since start   dist: m   speed: m/s   hr: bpm   cad: steps/min
#   alt: m   lat/lon: deg   power: W   vo: vertical oscillation mm
#   gct: ground contact ms   stride: m   temp: °C
STREAM_COLUMNS = [
    "t", "dist", "speed", "hr", "cad", "alt", "lat", "lon",
    "power", "vo", "gct", "stride", "temp",
]


@dataclass
class ParsedFit:
    summary: dict[str, Any]
    laps: list[dict[str, Any]] = field(default_factory=list)
    stream: pd.DataFrame | None = None


class NotAnActivityError(ValueError):
    """The FIT file has no session message (e.g. monitoring/sleep files)."""


def _first(vals: dict[str, Any], *keys: str) -> Any:
    for k in keys:
        v = vals.get(k)
        if v is not None:
            return v
    return None


def _deg(v: Any) -> float | None:
    return v * SEMICIRCLE_TO_DEG if isinstance(v, int) else None


def _utc(v: Any) -> datetime | None:
    if not isinstance(v, datetime):
        return None
    return v.astimezone(UTC).replace(tzinfo=None) if v.tzinfo else v


def sport_key(sport: Any, sub_sport: Any) -> str:
    sport = str(sport or "generic").lower()
    sub = str(sub_sport or "").lower()
    if sport == "running":
        return {
            "treadmill": "treadmill_running",
            "trail": "trail_running",
            "track": "track_running",
            "street": "street_running",
            "virtual_activity": "virtual_run",
            "indoor_running": "indoor_running",
        }.get(sub, "running")
    return sport


def is_running(sport: str | None) -> bool:
    return bool(sport) and ("run" in sport)


def parse_fit(data: bytes) -> ParsedFit:
    records: list[dict[str, Any]] = []
    laps_raw: list[dict[str, Any]] = []
    session: dict[str, Any] | None = None
    activity_msg: dict[str, Any] = {}

    with fitdecode.FitReader(io.BytesIO(data), check_crc=fitdecode.CrcCheck.WARN) as fit:
        for frame in fit:
            if frame.frame_type != fitdecode.FIT_FRAME_DATA:
                continue
            vals = {f.name: f.value for f in frame.fields}
            if frame.name == "record":
                records.append(vals)
            elif frame.name == "lap":
                laps_raw.append(vals)
            elif frame.name == "session" and session is None:
                session = vals  # multisport files: keep the first session
            elif frame.name == "activity":
                activity_msg = vals

    if session is None:
        raise NotAnActivityError("FIT file contains no session")

    start_utc = _utc(session.get("start_time"))
    if start_utc is None:
        raise NotAnActivityError("session has no start_time")

    # Local offset = activity.local_timestamp - activity.timestamp (FIT convention).
    offset = timedelta(0)
    local_ts, ts = activity_msg.get("local_timestamp"), activity_msg.get("timestamp")
    if isinstance(local_ts, datetime) and isinstance(ts, datetime):
        offset = local_ts.replace(tzinfo=None) - _utc(ts)
        offset = timedelta(minutes=round(offset.total_seconds() / 900) * 15)

    sport = sport_key(session.get("sport"), session.get("sub_sport"))
    cadence = _first(session, "avg_running_cadence", "avg_cadence")
    if cadence is not None and is_running(sport):
        cadence = cadence * 2  # FIT stores running cadence per foot

    summary = {
        "sport": sport,
        "start_time": start_utc + offset,
        "start_time_utc": start_utc,
        "distance_m": float(session.get("total_distance") or 0),
        "duration_s": float(session.get("total_elapsed_time") or 0),
        "moving_time_s": session.get("total_timer_time"),
        "elevation_gain_m": session.get("total_ascent"),
        "avg_hr": session.get("avg_heart_rate"),
        "max_hr": session.get("max_heart_rate"),
        "avg_speed_mps": _first(session, "enhanced_avg_speed", "avg_speed"),
        "avg_cadence": cadence,
        "calories": session.get("total_calories"),
        "start_lat": _deg(session.get("start_position_lat")),
        "start_lon": _deg(session.get("start_position_long")),
        "aerobic_te": session.get("total_training_effect"),
        "anaerobic_te": session.get("total_anaerobic_training_effect"),
    }

    laps = []
    for i, lap in enumerate(laps_raw):
        lap_dist = float(lap.get("total_distance") or 0)
        lap_time = float(_first(lap, "total_timer_time", "total_elapsed_time") or 0)
        # Some Garmin watches leave lap speed fields invalid (None); derive it from distance/time.
        lap_speed = _first(lap, "enhanced_avg_speed", "avg_speed")
        if lap_speed is None and lap_dist > 0 and lap_time > 0:
            lap_speed = lap_dist / lap_time
        lap_cad = _first(lap, "avg_running_cadence", "avg_cadence")
        if lap_cad is not None and is_running(sport):
            lap_cad *= 2
        laps.append({
            "idx": i,
            "distance_m": lap_dist,
            "duration_s": lap_time,
            "avg_hr": lap.get("avg_heart_rate"),
            "avg_speed_mps": lap_speed,
            "avg_cadence": lap_cad,
            "elevation_gain_m": lap.get("total_ascent"),
        })

    return ParsedFit(summary=summary, laps=laps, stream=_build_stream(records, start_utc, sport))


def _build_stream(records: list[dict[str, Any]], start_utc: datetime, sport: str) -> pd.DataFrame | None:
    rows = []
    for r in records:
        ts = _utc(r.get("timestamp"))
        if ts is None:
            continue
        cad = r.get("cadence")
        if cad is not None:
            cad = cad + (r.get("fractional_cadence") or 0)
            if is_running(sport):
                cad *= 2
        step_len = r.get("step_length")
        rows.append({
            "t": (ts - start_utc).total_seconds(),
            "dist": r.get("distance"),
            "speed": _first(r, "enhanced_speed", "speed"),
            "hr": r.get("heart_rate"),
            "cad": cad,
            "alt": _first(r, "enhanced_altitude", "altitude"),
            "lat": _deg(r.get("position_lat")),
            "lon": _deg(r.get("position_long")),
            "power": r.get("power"),
            "vo": r.get("vertical_oscillation"),
            "gct": r.get("stance_time"),
            "stride": step_len / 1000 if step_len is not None else None,
            "temp": r.get("temperature"),
        })
    if not rows:
        return None
    df = pd.DataFrame(rows, columns=STREAM_COLUMNS).astype("float64")
    df = df.drop_duplicates("t").sort_values("t").reset_index(drop=True)
    # Drop columns the device never recorded to keep files small.
    return df.dropna(axis=1, how="all")


def iter_fit_files(path: Path):
    """Like iter_fit_payloads but reads the top-level archive from disk (exports can be GBs)."""
    if path.suffix.lower() == ".fit":
        yield path.name, path.read_bytes()
        return
    if not zipfile.is_zipfile(path):
        return
    with zipfile.ZipFile(path) as zf:
        for info in zf.infolist():
            inner = info.filename.lower()
            if not info.is_dir() and inner.endswith((".fit", ".zip")):
                yield from iter_fit_payloads(info.filename, zf.read(info), 1)


def iter_fit_payloads(name: str, data: bytes, _depth: int = 0):
    """Yield (name, bytes) for every .fit inside a file, recursing into zips.

    Handles a single .fit, Garmin's per-activity "original" zip, and the full
    account export (zips nested inside DI_CONNECT/...).
    """
    lower = name.lower()
    if lower.endswith(".fit"):
        yield name, data
        return
    if not zipfile.is_zipfile(io.BytesIO(data)) or _depth > 3:
        return
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            inner = info.filename.lower()
            if inner.endswith((".fit", ".zip")):
                yield from iter_fit_payloads(info.filename, zf.read(info), _depth + 1)
