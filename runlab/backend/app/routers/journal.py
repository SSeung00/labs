import re
from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlmodel import col, select

from app.db import SessionDep
from app.models import CustomMetricDef, CustomMetricValue

router = APIRouter(tags=["journal"])


@router.get("/journal/defs")
def list_defs(session: SessionDep, include_archived: bool = False) -> list[CustomMetricDef]:
    stmt = select(CustomMetricDef).order_by(col(CustomMetricDef.sort_order), col(CustomMetricDef.label))
    if not include_archived:
        stmt = stmt.where(CustomMetricDef.archived.is_(False))
    return list(session.exec(stmt))


class DefBody(BaseModel):
    label: str
    kind: str = "number"
    unit: str | None = None
    icon: str | None = None
    options: list[str] | None = None
    scale_min: float | None = None
    scale_max: float | None = None
    polarity: str | None = "neutral"


@router.post("/journal/defs")
def create_def(body: DefBody, session: SessionDep) -> CustomMetricDef:
    if body.kind not in ("number", "scale", "bool", "text", "select"):
        raise HTTPException(400, "지원하지 않는 형식입니다.")
    base = re.sub(r"[^a-z0-9]+", "_", body.label.lower()).strip("_") or "metric"
    key, n = f"c_{base}", 1
    while session.get(CustomMetricDef, key):
        n += 1
        key = f"c_{base}_{n}"
    count = len(session.exec(select(CustomMetricDef.key)).all())
    row = CustomMetricDef(key=key, sort_order=count, builtin=False, **body.model_dump())
    if row.kind == "scale" and row.scale_min is None:
        row.scale_min, row.scale_max = 1, 5
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


class DefPatch(BaseModel):
    label: str | None = None
    unit: str | None = None
    archived: bool | None = None
    sort_order: int | None = None
    polarity: str | None = None


@router.patch("/journal/defs/{key}")
def patch_def(key: str, body: DefPatch, session: SessionDep) -> CustomMetricDef:
    row = session.get(CustomMetricDef, key)
    if not row:
        raise HTTPException(404, "지표를 찾을 수 없습니다.")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.get("/journal")
def list_entries(session: SessionDep, start: date | None = None, end: date | None = None) -> dict[str, dict[str, Any]]:
    end = end or date.today()
    start = start or end - timedelta(days=30)
    rows = session.exec(
        select(CustomMetricValue).where(CustomMetricValue.day >= start, CustomMetricValue.day <= end)
    ).all()
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        out.setdefault(r.day.isoformat(), {})[r.metric_key] = r.value_text if r.value_text is not None else r.value_num
    return out


@router.put("/journal/{day}")
def put_entry(day: date, values: dict[str, Any], session: SessionDep) -> dict[str, Any]:
    """Upsert a day's values. A null value deletes that metric for the day."""
    defs = {d.key: d for d in session.exec(select(CustomMetricDef))}
    for key, v in values.items():
        d = defs.get(key)
        if not d:
            raise HTTPException(400, f"알 수 없는 지표: {key}")
        row = session.get(CustomMetricValue, (day, key))
        if v is None or v == "":
            if row:
                session.delete(row)
            continue
        row = row or CustomMetricValue(day=day, metric_key=key)
        if d.kind in ("text", "select"):
            row.value_text, row.value_num = str(v), None
        elif d.kind == "bool":
            row.value_num, row.value_text = (1.0 if v in (True, 1, "1", "true") else 0.0), None
        else:
            try:
                row.value_num, row.value_text = float(v), None
            except (TypeError, ValueError) as e:
                raise HTTPException(400, f"{d.label}: 숫자를 입력하세요.") from e
        session.add(row)
    session.commit()
    return list_entries(session, day, day).get(day.isoformat(), {})
