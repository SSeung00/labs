import csv
import io
from datetime import date

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from sqlmodel import col, select

from app.db import SessionDep
from app.models import Activity, CustomMetricValue, DailyWellness

router = APIRouter(tags=["export"])

ACTIVITY_FIELDS = [
    "id", "garmin_id", "start_time", "sport", "name", "distance_m", "duration_s", "moving_time_s",
    "elevation_gain_m", "avg_hr", "max_hr", "avg_speed_mps", "gap_speed_mps", "avg_cadence", "calories",
    "aerobic_te", "anaerobic_te", "vo2max", "load", "load_source", "trimp", "hr_tss", "efficiency_factor",
    "decoupling_pct", "vdot_est", "rpe", "shoe_id", "note",
]


def _csv(rows: list[list], header: list[str], name: str) -> StreamingResponse:
    buf = io.StringIO()
    buf.write("﻿")  # BOM so Excel opens Korean text correctly
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(rows)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}-{date.today().isoformat()}.csv"'},
    )


@router.get("/export/activities.csv")
def export_activities(session: SessionDep) -> StreamingResponse:
    acts = session.exec(select(Activity).order_by(col(Activity.start_time))).all()
    rows = [[getattr(a, f) for f in ACTIVITY_FIELDS] for a in acts]
    return _csv(rows, ACTIVITY_FIELDS, "runlab-activities")


@router.get("/export/daily.csv")
def export_daily(session: SessionDep) -> StreamingResponse:
    """Wellness + journal values, one row per day."""
    wellness = {w.day: w for w in session.exec(select(DailyWellness))}
    values = session.exec(select(CustomMetricValue)).all()
    keys = sorted({v.metric_key for v in values})
    by_day: dict = {}
    for v in values:
        by_day.setdefault(v.day, {})[v.metric_key] = v.value_text if v.value_text is not None else v.value_num
    wfields = ["resting_hr", "hrv_avg", "sleep_total_s", "sleep_score", "body_battery_max", "stress_avg", "steps", "weight_kg", "training_readiness"]
    days = sorted(set(wellness) | set(by_day))
    rows = [[d.isoformat(), *[getattr(wellness.get(d), f, None) if d in wellness else None for f in wfields], *[by_day.get(d, {}).get(k) for k in keys]] for d in days]
    return _csv(rows, ["day", *wfields, *[f"journal_{k}" for k in keys]], "runlab-daily")
