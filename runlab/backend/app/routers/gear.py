from datetime import date, datetime, timedelta

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel
from sqlmodel import col, func, select

from app.db import SessionDep
from app.models import Activity, Gear, Injury

router = APIRouter(tags=["gear"])

RUN = col(Activity.sport).contains("run")


class GearBody(BaseModel):
    name: str
    brand: str | None = None
    purchased_on: date | None = None
    retire_at_km: float = 700
    initial_km: float = 0
    color: str | None = None
    color2: str | None = None
    note: str | None = None
    is_default: bool | None = None
    retired: bool | None = None


def _stats(session: SessionDep, g: Gear) -> dict:
    rows = session.exec(
        select(Activity.distance_m, Activity.moving_time_s, Activity.start_time, Activity.efficiency_factor, Activity.gap_speed_mps)
        .where(Activity.shoe_id == g.id)
    ).all()
    km = sum(r[0] or 0 for r in rows) / 1000
    total_km = km + (g.initial_km or 0)
    efs = [r[3] for r in rows if r[3]]
    t = sum(r[1] or 0 for r in rows)
    return {
        **g.model_dump(),
        "runs": len(rows),
        "km": round(total_km, 1),
        "tracked_km": round(km, 1),
        "avg_pace_s_per_km": round(t / km, 1) if km else None,
        "avg_ef": round(sum(efs) / len(efs), 3) if efs else None,
        "last_used": max((r[2] for r in rows), default=None),
        "first_used": min((r[2] for r in rows), default=None),
        "wear": round(total_km / g.retire_at_km, 3) if g.retire_at_km else None,
    }


@router.get("/gear")
def list_gear(session: SessionDep) -> list[dict]:
    items = session.exec(select(Gear).order_by(col(Gear.retired), col(Gear.id))).all()
    unassigned = session.exec(select(func.count()).select_from(Activity).where(RUN, col(Activity.shoe_id).is_(None))).one()
    return [{**_stats(session, g), "unassigned_runs": unassigned} for g in items]


@router.post("/gear")
def create_gear(body: GearBody, session: SessionDep) -> dict:
    g = Gear(**body.model_dump(exclude_none=True))
    if g.is_default:
        for other in session.exec(select(Gear).where(Gear.is_default.is_(True))):
            other.is_default = False
            session.add(other)
    session.add(g)
    session.commit()
    session.refresh(g)
    return _stats(session, g)


@router.patch("/gear/{gid}")
def patch_gear(gid: int, body: dict, session: SessionDep) -> dict:
    g = session.get(Gear, gid)
    if not g:
        raise HTTPException(404, "장비를 찾을 수 없습니다.")
    data = GearBody(**{**g.model_dump(), **body}).model_dump()
    for k, v in data.items():
        setattr(g, k, v)
    if body.get("is_default"):
        for other in session.exec(select(Gear).where(Gear.is_default.is_(True), Gear.id != gid)):
            other.is_default = False
            session.add(other)
    session.add(g)
    session.commit()
    session.refresh(g)
    return _stats(session, g)


@router.post("/gear/import-csv")
async def import_gear_csv(file: UploadFile, session: SessionDep) -> dict:
    """Assign shoes (and race labels/titles) from the user's own activity spreadsheet."""
    from app.analytics.run_type import classify_all
    from app.ingest.shoes_csv import import_csv

    raw = await file.read()
    for enc in ("utf-8-sig", "cp949"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise HTTPException(400, "CSV 인코딩을 읽지 못했어요 (UTF-8 또는 CP949).")
    result = import_csv(session, text)
    classify_all(session)  # new titles → better auto types
    return result


@router.delete("/gear/{gid}")
def delete_gear(gid: int, session: SessionDep) -> dict:
    g = session.get(Gear, gid)
    if g:
        for a in session.exec(select(Activity).where(Activity.shoe_id == gid)):
            a.shoe_id = None
            session.add(a)
        session.delete(g)
        session.commit()
    return {"ok": True}


class AssignBody(BaseModel):
    start: date
    end: date | None = None
    overwrite: bool = False


@router.post("/gear/{gid}/assign")
def assign_gear(gid: int, body: AssignBody, session: SessionDep) -> dict:
    """Bulk-assign this shoe to runs in a date range (default: only runs without a shoe)."""
    if not session.get(Gear, gid):
        raise HTTPException(404, "장비를 찾을 수 없습니다.")
    stmt = select(Activity).where(RUN, Activity.start_time >= datetime.combine(body.start, datetime.min.time()))
    if body.end:
        stmt = stmt.where(Activity.start_time < datetime.combine(body.end + timedelta(days=1), datetime.min.time()))
    if not body.overwrite:
        stmt = stmt.where(col(Activity.shoe_id).is_(None))
    n = 0
    for a in session.exec(stmt):
        a.shoe_id = gid
        session.add(a)
        n += 1
    session.commit()
    return {"assigned": n}


# ── Injuries ──────────────────────────────────────────────────────────


class InjuryBody(BaseModel):
    body_part: str
    side: str | None = None
    map_x: float | None = None
    map_y: float | None = None
    severity: int = 2
    start_day: date
    end_day: date | None = None
    note: str | None = None


@router.get("/injuries")
def list_injuries(session: SessionDep) -> list[Injury]:
    return list(session.exec(select(Injury).order_by(col(Injury.start_day).desc())))


@router.post("/injuries")
def create_injury(body: InjuryBody, session: SessionDep) -> Injury:
    i = Injury(**body.model_dump())
    session.add(i)
    session.commit()
    session.refresh(i)
    return i


@router.patch("/injuries/{iid}")
def patch_injury(iid: int, body: dict, session: SessionDep) -> Injury:
    i = session.get(Injury, iid)
    if not i:
        raise HTTPException(404, "기록을 찾을 수 없습니다.")
    for k, v in InjuryBody(**{**i.model_dump(), **body}).model_dump().items():
        setattr(i, k, v)
    session.add(i)
    session.commit()
    session.refresh(i)
    return i


@router.delete("/injuries/{iid}")
def delete_injury(iid: int, session: SessionDep) -> dict:
    i = session.get(Injury, iid)
    if i:
        session.delete(i)
        session.commit()
    return {"ok": True}
