"""Persist parsed activities: summary + laps in SQLite, streams in Parquet."""

from __future__ import annotations

from typing import Any

import pandas as pd
from sqlmodel import Session, delete, select

from app.config import STREAMS_DIR
from app.models import Activity, Gear, Lap


def stream_path(activity_id: int):
    return STREAMS_DIR / f"{activity_id}.parquet"


def load_stream(activity_id: int) -> pd.DataFrame | None:
    p = stream_path(activity_id)
    return pd.read_parquet(p) if p.exists() else None


def find_existing(session: Session, garmin_id: int | None, start_time_utc) -> Activity | None:
    if garmin_id is not None:
        hit = session.exec(select(Activity).where(Activity.garmin_id == garmin_id)).first()
        if hit:
            return hit
    if start_time_utc is not None:
        return session.exec(
            select(Activity).where(Activity.start_time_utc == start_time_utc)
        ).first()
    return None


def save_activity(
    session: Session,
    summary: dict[str, Any],
    laps: list[dict[str, Any]] | None = None,
    stream: pd.DataFrame | None = None,
) -> tuple[Activity, bool]:
    """Insert or enrich an activity. Returns (activity, created).

    Existing rows keep user-entered fields; only empty fields are filled, and
    laps/stream are attached if the row doesn't have them yet.
    """
    existing = find_existing(session, summary.get("garmin_id"), summary.get("start_time_utc"))
    created = existing is None
    if existing is None:
        act = Activity(**{k: v for k, v in summary.items() if k in Activity.model_fields})
        if "run" in (act.sport or "") and act.shoe_id is None:
            default = session.exec(select(Gear.id).where(Gear.is_default.is_(True), Gear.retired.is_(False))).first()
            act.shoe_id = default
        session.add(act)
        session.flush()
    else:
        act = existing
        for k, v in summary.items():
            if k in Activity.model_fields and v is not None and getattr(act, k) in (None, 0):
                setattr(act, k, v)

    if laps and (created or not session.exec(select(Lap.id).where(Lap.activity_id == act.id)).first()):
        session.exec(delete(Lap).where(Lap.activity_id == act.id))
        for lap in laps:
            session.add(Lap(activity_id=act.id, **lap))

    if stream is not None and not stream.empty and not act.has_stream:
        stream.to_parquet(stream_path(act.id), index=False, compression="zstd")
        act.has_stream = True

    session.add(act)
    session.commit()
    session.refresh(act)
    return act, created
