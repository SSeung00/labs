from collections import defaultdict
from datetime import date, datetime, timedelta

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func
from sqlmodel import col, select, update

from app.db import SessionDep
from app.engine.categories import TRAVEL_BOOKING
from app.engine.pipeline import reprocess
from app.models import TRIP_KINDS, Category, Claim, Trip, Txn
from app.routers.claims import claim_view
from app.routers.transactions import accounts_by_id, serialize

router = APIRouter(tags=["trips"])


class TripIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    kind: str = "travel"  # travel | event (학회·단체 행사)
    start_date: date
    end_date: date
    budget: int | None = Field(default=None, ge=0)
    note: str | None = None

    @model_validator(mode="after")
    def _order(self):
        if self.end_date < self.start_date:
            raise ValueError("끝나는 날이 시작일보다 빨라요.")
        if self.kind not in TRIP_KINDS:
            raise ValueError("여행 또는 행사만 고를 수 있어요.")
        return self


def _spent_by_trip(session) -> dict[int, tuple[int, int]]:
    rows = session.exec(
        select(Txn.trip_id, func.sum(Txn.amount), func.count())
        .where(col(Txn.trip_id).is_not(None), Txn.kind == "expense", col(Txn.dup_of_id).is_(None))
        .group_by(Txn.trip_id)
    ).all()
    return {tid: (-s, n) for tid, s, n in rows}


def _claims_for(session, trip_id: int) -> dict | None:
    """What I paid for others at this event (학회·단체) and how much has come back."""
    views = [claim_view(session, c) for c in session.exec(select(Claim).where(Claim.trip_id == trip_id)).all()]
    if not views:
        return None
    return {
        "ids": [v["id"] for v in views],
        "paid": sum(v["paid"] for v in views),
        "reimbursed": sum(v["reimbursed"] for v in views),
        "outstanding": sum(v["outstanding"] for v in views if v["status"] == "open"),
        "open": any(v["status"] == "open" for v in views),
    }


def _trip_dict(t: Trip, spent: tuple[int, int] | None, session=None) -> dict:
    days = (t.end_date - t.start_date).days + 1
    amount, count = spent or (0, 0)
    return {
        **t.model_dump(),
        "days": days,
        "spent": amount,
        "count": count,
        "per_day": round(amount / days) if days else 0,
        "claims": _claims_for(session, t.id) if session is not None else None,
    }


@router.get("/trips")
def list_trips(session: SessionDep) -> list[dict]:
    spent = _spent_by_trip(session)
    trips = session.exec(select(Trip).order_by(col(Trip.start_date).desc())).all()
    return [_trip_dict(t, spent.get(t.id), session) for t in trips]


@router.post("/trips")
def create_trip(body: TripIn, session: SessionDep) -> dict:
    t = Trip(**body.model_dump())
    session.add(t)
    session.commit()
    reprocess(session)
    session.refresh(t)
    return _trip_dict(t, _spent_by_trip(session).get(t.id))


@router.put("/trips/{trip_id}")
def update_trip(trip_id: int, body: TripIn, session: SessionDep) -> dict:
    t = session.get(Trip, trip_id)
    if not t:
        raise HTTPException(404, "여행을 찾을 수 없어요.")
    for k, v in body.model_dump().items():
        setattr(t, k, v)
    session.add(t)
    session.commit()
    reprocess(session)
    session.refresh(t)
    return _trip_dict(t, _spent_by_trip(session).get(t.id))


@router.delete("/trips/{trip_id}")
def delete_trip(trip_id: int, session: SessionDep) -> dict:
    t = session.get(Trip, trip_id)
    if not t:
        raise HTTPException(404, "여행을 찾을 수 없어요.")
    session.exec(
        update(Txn).where(Txn.trip_id == trip_id).values(trip_id=None, trip_locked=False)
    )
    session.exec(update(Claim).where(Claim.trip_id == trip_id).values(trip_id=None))
    session.delete(t)
    session.commit()
    reprocess(session)
    return {"ok": True}


@router.get("/trips/{trip_id}")
def trip_detail(trip_id: int, session: SessionDep) -> dict:
    t = session.get(Trip, trip_id)
    if not t:
        raise HTTPException(404, "여행을 찾을 수 없어요.")
    cats = {c.name: c for c in session.exec(select(Category)).all()}
    accounts = accounts_by_id(session)
    items = session.exec(
        select(Txn)
        .where(Txn.trip_id == trip_id, Txn.kind == "expense", col(Txn.dup_of_id).is_(None))
        .order_by(Txn.occurred_at)
    ).all()

    by_cat: dict[str, int] = defaultdict(int)
    phase = {"before": 0, "during": 0, "after": 0}
    by_day: dict[str, int] = defaultdict(int)
    for x in items:
        by_cat[x.category] -= x.amount
        d = x.occurred_at.date()
        if d < t.start_date:
            phase["before"] -= x.amount
        elif d > t.end_date:
            phase["after"] -= x.amount
        else:
            phase["during"] -= x.amount
            by_day[d.isoformat()] -= x.amount

    # Travel-looking spending around the trip that isn't attached to any trip.
    window_start = datetime.combine(t.start_date - timedelta(days=365), datetime.min.time())
    window_end = datetime.combine(t.end_date + timedelta(days=30), datetime.min.time())
    candidates = session.exec(
        select(Txn)
        .where(
            col(Txn.trip_id).is_(None), Txn.kind == "expense", col(Txn.dup_of_id).is_(None),
            col(Txn.category).in_(TRAVEL_BOOKING), Txn.occurred_at >= window_start, Txn.occurred_at < window_end,
        )
        .order_by(col(Txn.occurred_at).desc())
    ).all()

    fx: dict[str, dict] = {}
    for x in items:
        if x.fx_currency and x.fx_amount:
            f = fx.setdefault(x.fx_currency, {"currency": x.fx_currency, "foreign": 0.0, "krw": 0, "count": 0})
            f["foreign"] += x.fx_amount * (1 if x.amount < 0 else -1)
            f["krw"] -= x.amount
            f["count"] += 1
    fees = sum(x.fee or 0 for x in items)
    for f in fx.values():
        f["rate"] = round(f["krw"] / f["foreign"], 4) if f["foreign"] else None

    # An event's 정산 rows (what I paid for others, what came back) belong on its page too.
    claim_ids = [c.id for c in session.exec(select(Claim).where(Claim.trip_id == t.id)).all()]
    claim_items = session.exec(
        select(Txn).where(col(Txn.claim_id).in_(claim_ids)).order_by(Txn.occurred_at)
    ).all() if claim_ids else []

    spent = _spent_by_trip(session).get(t.id)
    return {
        **_trip_dict(t, spent, session),
        "claim_items": [serialize(x, accounts) for x in claim_items],
        "fx": sorted(fx.values(), key=lambda f: -f["krw"]),
        "fees": fees,
        "phase": phase,
        "by_category": sorted(
            (
                {"category": c, "amount": a, "color": cats[c].color if c in cats else "#999"}
                for c, a in by_cat.items()
            ),
            key=lambda r: -r["amount"],
        ),
        "by_day": [
            {"date": (t.start_date + timedelta(days=i)).isoformat(),
             "amount": by_day.get((t.start_date + timedelta(days=i)).isoformat(), 0)}
            for i in range((t.end_date - t.start_date).days + 1)
        ],
        "items": [serialize(x, accounts) for x in items],
        "candidates": [serialize(x, accounts) for x in candidates],
    }
