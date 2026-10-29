"""정산: money that should come back to me.

- reimburse: paying for the lab / a conference / friends on my own card, paid back later.
- loan: money lent (e.g. to family), an asset until it's repaid.

Rows linked to a claim become kind "claim": they leave spending, income and budgets, and the
claim tracks what's still owed to me. Closing a claim books the difference once — a
shortfall as my own spending, a surplus (일비 등 more than I paid) as income — so nothing
silently disappears.
"""

import hashlib
import uuid
from datetime import date, datetime, timedelta

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import Session, col, select

from app.db import SessionDep
from app.engine.pipeline import reprocess
from app.models import CLAIM_KINDS, Account, Category, Claim, Trip, Txn
from app.routers.transactions import accounts_by_id, serialize

router = APIRouter(tags=["claims"])

ADJUST_ACCOUNT = "정산 조정"


def claim_view(session: Session, c: Claim, with_rows: bool = False) -> dict:
    rows = session.exec(select(Txn).where(Txn.claim_id == c.id).order_by(Txn.occurred_at)).all()
    counted = [t for t in rows if t.dup_of_id is None]  # one payment seen twice counts once
    paid = -sum(t.amount for t in counted if t.amount < 0)
    back = sum(t.amount for t in counted if t.amount > 0)
    trip = session.get(Trip, c.trip_id) if c.trip_id else None
    out = {
        **c.model_dump(),
        "trip_name": trip.name if trip else None,
        "paid": paid,
        "reimbursed": back,
        "outstanding": paid - back,
        "count": len(rows),
        "first_date": rows[0].occurred_at.date() if rows else None,
    }
    if with_rows:
        accounts = accounts_by_id(session)
        out["items"] = [serialize(t, accounts) for t in rows]
    return out


def outstanding_total(session: Session) -> int:
    # A claim that paid back more than I spent (일비 등) doesn't offset another one still owed.
    return sum(max(0, claim_view(session, c)["outstanding"]) for c in session.exec(select(Claim).where(Claim.status == "open")).all())


@router.get("/claims")
def list_claims(session: SessionDep) -> dict:
    claims = session.exec(select(Claim).order_by(Claim.status.desc(), col(Claim.id).desc())).all()
    views = [claim_view(session, c) for c in claims]
    return {"claims": views, "outstanding": sum(max(0, v["outstanding"]) for v in views if v["status"] == "open")}


class ClaimIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    kind: str = "reimburse"
    trip_id: int | None = None
    expected_date: date | None = None
    note: str | None = None
    txn_ids: list[int] = []


def _check(body: ClaimIn, session: Session) -> None:
    if body.kind not in CLAIM_KINDS:
        raise HTTPException(422, "알 수 없는 정산 종류예요.")
    if body.trip_id and not session.get(Trip, body.trip_id):
        raise HTTPException(404, "연결할 여행·행사를 찾을 수 없어요.")


@router.post("/claims")
def create_claim(body: ClaimIn, session: SessionDep) -> dict:
    _check(body, session)
    c = Claim(name=body.name.strip(), kind=body.kind, trip_id=body.trip_id, expected_date=body.expected_date,
              note=body.note, created_at=datetime.now())
    session.add(c)
    session.flush()
    for t in session.exec(select(Txn).where(col(Txn.id).in_(body.txn_ids))).all() if body.txn_ids else []:
        t.claim_id = c.id
        session.add(t)
    session.commit()
    reprocess(session)
    session.refresh(c)
    return claim_view(session, c, with_rows=True)


@router.put("/claims/{cid}")
def update_claim(cid: int, body: ClaimIn, session: SessionDep) -> dict:
    c = session.get(Claim, cid)
    if not c:
        raise HTTPException(404, "정산을 찾을 수 없어요.")
    _check(body, session)
    c.name, c.kind, c.trip_id = body.name.strip(), body.kind, body.trip_id
    c.expected_date, c.note = body.expected_date, body.note
    session.add(c)
    session.commit()
    return claim_view(session, c, with_rows=True)


@router.delete("/claims/{cid}")
def delete_claim(cid: int, session: SessionDep) -> dict:
    c = session.get(Claim, cid)
    if not c:
        raise HTTPException(404, "정산을 찾을 수 없어요.")
    for t in session.exec(select(Txn).where(Txn.claim_id == cid)).all():
        t.claim_id = None
        session.add(t)
    for t in _adjustments(session, c):
        session.delete(t)
    session.delete(c)
    session.commit()
    reprocess(session)
    return {"ok": True}


@router.get("/claims/{cid}")
def claim_detail(cid: int, session: SessionDep) -> dict:
    c = session.get(Claim, cid)
    if not c:
        raise HTTPException(404, "정산을 찾을 수 없어요.")
    v = claim_view(session, c, with_rows=True)
    # Likely pay-backs: money coming in after the first payment, not already linked — from
    # someone already in this claim first (a loan comes back from the same person), then
    # closest in size to what's still owed.
    since = datetime.combine(v["first_date"] or date.today() - timedelta(days=90), datetime.min.time())
    cands = session.exec(
        select(Txn).where(
            Txn.amount > 0, col(Txn.claim_id).is_(None), Txn.occurred_at >= since,
            col(Txn.kind).in_(("transfer", "income")),
        ).order_by(Txn.occurred_at).limit(300)
    ).all()
    owed = max(v["outstanding"], 1)
    people = {t["merchant"] for t in v["items"]}
    cands = sorted(cands, key=lambda t: (t.merchant not in people, abs(t.amount - owed)))[:12]
    accounts = accounts_by_id(session)
    v["candidates"] = [serialize(t, accounts) for t in cands]
    return v


class LinkIn(BaseModel):
    txn_ids: list[int]
    linked: bool = True


@router.post("/claims/{cid}/link")
def link(cid: int, body: LinkIn, session: SessionDep) -> dict:
    c = session.get(Claim, cid)
    if not c:
        raise HTTPException(404, "정산을 찾을 수 없어요.")
    for t in session.exec(select(Txn).where(col(Txn.id).in_(body.txn_ids))).all():
        t.claim_id = cid if body.linked else None
        session.add(t)
    session.commit()
    reprocess(session)
    return claim_detail(cid, session)


class CloseIn(BaseModel):
    book_shortfall: bool = True  # book the difference: a shortfall as spending, a surplus as income


def _adjustments(session: Session, c: Claim) -> list[Txn]:
    names = (f"정산 차액: {c.name}", f"정산 차익: {c.name}")
    return list(session.exec(select(Txn).where(col(Txn.merchant).in_(names), Txn.source == "manual")).all())


def _adjust_account(session: Session) -> Account:
    acc = session.exec(select(Account).where(Account.name == ADJUST_ACCOUNT)).first()
    if not acc:
        acc = Account(name=ADJUST_ACCOUNT, kind="other", hidden=True)
        session.add(acc)
        session.flush()
    return acc


@router.post("/claims/{cid}/close")
def close(cid: int, body: CloseIn, session: SessionDep) -> dict:
    c = session.get(Claim, cid)
    if not c:
        raise HTTPException(404, "정산을 찾을 수 없어요.")
    gap = claim_view(session, c)["outstanding"]
    if gap and body.book_shortfall:
        # Booked once, on a separate account so bank balance checks aren't disturbed.
        acc = _adjust_account(session)
        cats = {cat.name for cat in session.exec(select(Category)).all()}
        trip = session.get(Trip, c.trip_id) if c.trip_id else None
        event = trip if trip and trip.kind == "event" else None
        # Dated at the claim's last movement, so the month it lands in is the month it settled.
        last = session.exec(select(func.max(Txn.occurred_at)).where(Txn.claim_id == cid)).one()
        when = last + timedelta(seconds=1) if last else datetime.now().replace(microsecond=0)
        if gap > 0:  # never came back: my own spending
            rows = session.exec(select(Txn).where(Txn.claim_id == cid, Txn.amount < 0)).all()
            if event:
                cat = "학회·행사"
            elif c.kind == "loan":
                cat = "경조·선물"
            else:
                cat = max(rows, key=lambda t: -t.amount).category if rows else "기타"
            merchant, kind, note = f"정산 차액: {c.name}", "expense", "정산에서 돌려받지 못한 금액"
        else:  # got back more than I paid (일비·여비 정액 등): income
            cat, merchant, kind, note = "기타수입", f"정산 차익: {c.name}", "income", "정산에서 낸 것보다 더 받은 금액"
        session.add(Txn(
            account_id=acc.id, occurred_at=when, amount=-gap,
            merchant=merchant, src_type="지출" if gap > 0 else "수입", source="manual",
            base_key=hashlib.sha1(f"claim|{uuid.uuid4()}".encode()).hexdigest(), occurrence=1,
            category=cat if cat in cats else "기타", category_locked=True, kind=kind, kind_locked=True,
            trip_id=event.id if event and gap > 0 else None, trip_locked=bool(event and gap > 0), note=note,
        ))
    c.status, c.closed_at = "closed", datetime.now()
    session.add(c)
    session.commit()
    reprocess(session)
    return claim_view(session, c, with_rows=True)


@router.post("/claims/{cid}/reopen")
def reopen(cid: int, session: SessionDep) -> dict:
    c = session.get(Claim, cid)
    if not c:
        raise HTTPException(404, "정산을 찾을 수 없어요.")
    for t in _adjustments(session, c):
        session.delete(t)
    c.status, c.closed_at = "open", None
    session.add(c)
    session.commit()
    reprocess(session)
    return claim_view(session, c, with_rows=True)
