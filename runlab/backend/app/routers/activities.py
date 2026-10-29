from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlmodel import col, func, or_, select

from app.analytics.profile import ZONE_NAMES, effective_profile
from app.analytics.run_type import REVIEW_BELOW, classify_all
from app.db import SessionDep
from app.ingest.store import load_stream
from app.models import Activity, BestEffort, DailyWellness, Lap

router = APIRouter(tags=["activities"])

RUN_FILTER = col(Activity.sport).contains("run")
TYPE_PRIORITY = ["race", "long", "workout", "easy", "recovery"]


@router.get("/activities")
def list_activities(
    session: SessionDep,
    limit: int = 50,
    offset: int = 0,
    sport: str = "run",  # run | all | <exact sport key>
    q: str | None = None,
    sort: str = "start_time",
    order: str = "desc",
    run_type: str | None = None,
    review: bool = False,
    month: str | None = None,  # YYYY-MM
) -> dict:
    stmt = select(Activity)
    if month:
        try:
            first = datetime.strptime(month, "%Y-%m")
        except ValueError as e:
            raise HTTPException(422, "month는 YYYY-MM 형식이어야 해요.") from e
        nxt = first.replace(year=first.year + 1, month=1) if first.month == 12 else first.replace(month=first.month + 1)
        stmt = stmt.where(Activity.start_time >= first, Activity.start_time < nxt)
    if sport == "run":
        stmt = stmt.where(RUN_FILTER)
    elif sport != "all":
        stmt = stmt.where(Activity.sport == sport)
    if run_type:
        stmt = stmt.where(Activity.run_type == run_type)
    if review:
        stmt = stmt.where(Activity.run_type_source == "auto", col(Activity.run_type_confidence) < REVIEW_BELOW)
    if q:
        stmt = stmt.where(or_(col(Activity.name).contains(q), col(Activity.note).contains(q)))
    total = session.exec(select(func.count()).select_from(stmt.subquery())).one()
    sort_col = {
        "start_time": Activity.start_time,
        "distance": Activity.distance_m,
        "duration": Activity.duration_s,
        "pace": Activity.avg_speed_mps,
        "hr": Activity.avg_hr,
    }.get(sort, Activity.start_time)
    sort_expr = col(sort_col).desc() if order == "desc" else col(sort_col).asc()
    rows = session.exec(stmt.order_by(sort_expr).offset(offset).limit(min(limit, 500))).all()
    return {"total": total, "items": rows}


@router.get("/activities/calendar")
def calendar(session: SessionDep, days: int = 371) -> list[dict]:
    """Daily running totals for the heatmap."""
    since = datetime.combine(date.today() - timedelta(days=days), datetime.min.time())
    rows = session.exec(
        select(Activity).where(RUN_FILTER, Activity.start_time >= since).order_by(col(Activity.start_time))
    ).all()
    by_day: dict[str, dict] = {}
    for a in rows:
        k = a.start_time.date().isoformat()
        d = by_day.setdefault(k, {"day": k, "distance_m": 0.0, "duration_s": 0.0, "count": 0, "runs": []})
        d["distance_m"] += a.distance_m or 0
        d["duration_s"] += a.duration_s or 0
        d["count"] += 1
        d["runs"].append({"id": a.id, "name": a.name, "km": round((a.distance_m or 0) / 1000, 2), "run_type": a.run_type})
    for d in by_day.values():
        # The day's colour: the most significant session type.
        types = [r["run_type"] for r in d["runs"] if r["run_type"]]
        d["run_type"] = min(types, key=TYPE_PRIORITY.index) if types else None
    return sorted(by_day.values(), key=lambda r: r["day"])


@router.get("/activities/run-types")
def run_type_summary(session: SessionDep, days: int = 365) -> dict:
    since = datetime.combine(date.today() - timedelta(days=days), datetime.min.time())
    rows = session.exec(
        select(Activity.run_type, Activity.run_type_source, Activity.run_type_confidence, Activity.distance_m)
        .where(RUN_FILTER, Activity.start_time >= since)
    ).all()
    counts: dict[str, dict] = {t: {"count": 0, "km": 0.0} for t in TYPE_PRIORITY}
    review = 0
    for t, src, conf, dist in rows:
        if t in counts:
            counts[t]["count"] += 1
            counts[t]["km"] += (dist or 0) / 1000
        if src == "auto" and (conf or 0) < REVIEW_BELOW:
            review += 1
    return {"types": counts, "review": review}


@router.get("/activities/weekly")
def weekly(session: SessionDep, weeks: int = 16) -> list[dict]:
    """Monday-based weekly running volume, including empty weeks."""
    today = date.today()
    this_monday = today - timedelta(days=today.weekday())
    first = this_monday - timedelta(weeks=weeks - 1)
    rows = session.exec(
        select(Activity.start_time, Activity.distance_m, Activity.duration_s, Activity.elevation_gain_m)
        .where(RUN_FILTER, Activity.start_time >= datetime.combine(first, datetime.min.time()))
    ).all()
    out = {
        (first + timedelta(weeks=i)).isoformat(): {
            "week": (first + timedelta(weeks=i)).isoformat(), "distance_m": 0.0, "duration_s": 0.0, "elevation_m": 0.0, "count": 0,
        }
        for i in range(weeks)
    }
    for st, dist, dur, elev in rows:
        wk = (st.date() - timedelta(days=st.weekday())).isoformat()
        if wk in out:
            out[wk]["distance_m"] += dist or 0
            out[wk]["duration_s"] += dur or 0
            out[wk]["elevation_m"] += elev or 0
            out[wk]["count"] += 1
    return list(out.values())


@router.get("/activities/monthly")
def monthly(session: SessionDep) -> list[dict]:
    """Running volume per calendar month, oldest first, including empty months."""
    rows = session.exec(
        select(
            Activity.start_time, Activity.distance_m, func.coalesce(Activity.moving_time_s, Activity.duration_s), Activity.run_type
        ).where(RUN_FILTER)
    ).all()
    if not rows:
        return []
    out: dict[str, dict] = {}
    first = min(r[0] for r in rows).date().replace(day=1)
    last = date.today().replace(day=1)
    m = first
    while m <= last:
        key = m.strftime("%Y-%m")
        out[key] = {"month": key, "count": 0, "distance_m": 0.0, "duration_s": 0.0, "by_type": {}}
        m = m.replace(year=m.year + 1, month=1) if m.month == 12 else m.replace(month=m.month + 1)
    for st, dist, dur, rt in rows:
        b = out.get(st.strftime("%Y-%m"))
        if b is None:
            continue
        b["count"] += 1
        b["distance_m"] += dist or 0
        b["duration_s"] += dur or 0
        t = rt or "easy"
        b["by_type"][t] = b["by_type"].get(t, 0.0) + (dist or 0)
    return list(out.values())


@router.get("/activities/{activity_id}")
def get_activity(activity_id: int, session: SessionDep) -> dict:
    act = session.get(Activity, activity_id)
    if not act:
        raise HTTPException(404, "활동을 찾을 수 없습니다.")
    laps = session.exec(select(Lap).where(Lap.activity_id == activity_id).order_by(Lap.idx)).all()
    prof = effective_profile(session)
    wellness = session.get(DailyWellness, act.start_time.date())
    prev_id = session.exec(
        select(Activity.id).where(RUN_FILTER, Activity.start_time < act.start_time).order_by(col(Activity.start_time).desc())
    ).first()
    next_id = session.exec(
        select(Activity.id).where(RUN_FILTER, Activity.start_time > act.start_time).order_by(col(Activity.start_time).asc())
    ).first()
    return {
        "activity": act,
        "laps": laps,
        "hr_zones": {
            "bounds": prof.zone_bounds,
            "names": ZONE_NAMES,
            "seconds": act.zone_seconds or [],
            "method": prof.zone_method,
            "max_hr": round(prof.max_hr),
            "lthr": round(prof.lthr),
        },
        "best_efforts": [
            {"distance_m": b.distance_m, "time_s": b.time_s, "start_offset_s": b.start_offset_s}
            for b in session.exec(
                select(BestEffort).where(BestEffort.activity_id == activity_id).order_by(col(BestEffort.distance_m))
            )
        ],
        "wellness": wellness,
        "prev_id": prev_id,
        "next_id": next_id,
    }


class ActivityPatch(BaseModel):
    name: str | None = None
    rpe: int | None = None
    note: str | None = None
    shoe_id: int | None = None
    run_type: str | None = None  # set → manual; "auto" → hand back to the classifier


@router.patch("/activities/{activity_id}")
def patch_activity(activity_id: int, body: ActivityPatch, session: SessionDep) -> Activity:
    act = session.get(Activity, activity_id)
    if not act:
        raise HTTPException(404, "활동을 찾을 수 없습니다.")
    data = body.model_dump(exclude_unset=True)
    rt = data.pop("run_type", None)
    for k, v in data.items():
        setattr(act, k, v)
    if rt == "auto":
        act.run_type_source = None
    elif rt:
        if rt not in TYPE_PRIORITY:
            raise HTTPException(400, "알 수 없는 훈련 종류")
        act.run_type, act.run_type_source, act.run_type_confidence, act.run_type_reason = rt, "manual", 1.0, "직접 지정"
    session.add(act)
    session.commit()
    if rt == "auto" or "name" in data:
        classify_all(session)
    session.refresh(act)
    return act


def _clean(a: np.ndarray, digits: int) -> list:
    return [None if (v is None or np.isnan(v)) else round(float(v), digits) for v in a]


@router.get("/activities/{activity_id}/stream")
def get_stream(activity_id: int, session: SessionDep, points: int = 1200) -> dict:
    """Downsampled stream for charts + full-resolution-enough route for the map."""
    if not session.get(Activity, activity_id):
        raise HTTPException(404, "활동을 찾을 수 없습니다.")
    df = load_stream(activity_id)
    if df is None or df.empty:
        return {"n": 0, "series": {}, "route": []}

    # Smooth noisy channels before decimating so peaks aren't aliased.
    if "speed" in df:
        df["speed"] = df["speed"].rolling(7, center=True, min_periods=1).median()
    if "alt" in df:
        df["alt"] = df["alt"].rolling(5, center=True, min_periods=1).mean()

    step = max(1, len(df) // max(points, 50))
    s = df.iloc[::step].reset_index(drop=True)

    pace = None
    if "speed" in s:
        spd = s["speed"].to_numpy(dtype=float)
        with np.errstate(divide="ignore", invalid="ignore"):
            pace = np.where(spd > 0.8, 1000.0 / spd, np.nan)  # s/km; < 0.8 m/s ≈ stopped

    series: dict[str, list] = {"t": _clean(s["t"].to_numpy(), 1)}
    if "dist" in s:
        series["dist"] = _clean(s["dist"].to_numpy() / 1000.0, 3)
    if pace is not None:
        series["pace"] = _clean(pace, 1)
    for key, digits in (("hr", 0), ("alt", 1), ("cad", 0), ("power", 0), ("vo", 1), ("gct", 0), ("stride", 2)):
        if key in s and not s[key].isna().all():
            series[key] = _clean(s[key].to_numpy(dtype=float), digits)

    route: list = []
    if "lat" in df and not df["lat"].isna().all():
        geo = df[["lat", "lon", "t"]].dropna()
        geo_step = max(1, len(geo) // 2500)
        geo = geo.iloc[::geo_step]
        # Attach pace to each route vertex for the gradient line.
        if "speed" in df:
            spd = df.loc[geo.index, "speed"].to_numpy(dtype=float)
            with np.errstate(divide="ignore", invalid="ignore"):
                rp = np.where(spd > 0.8, 1000.0 / spd, np.nan)
            rp = pd.Series(rp).ffill().bfill().to_numpy()
        else:
            rp = np.full(len(geo), np.nan)
        route = [[round(lo, 6), round(la, 6), round(float(t), 1), None if np.isnan(p) else round(float(p), 1)]
                 for la, lo, t, p in zip(geo["lat"], geo["lon"], geo["t"], rp, strict=True)]
    return {"n": len(s), "series": series, "route": route}
