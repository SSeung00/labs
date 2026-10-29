import re
from datetime import date, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlmodel import Session, col, select

from app.db import SessionDep
from app.engine.categories import family
from app.engine.pipeline import VAGUE_CATEGORIES, reprocess
from app.models import KINDS, Account, Category, Claim, Rule, Txn

router = APIRouter(tags=["transactions"])

BIG_TRANSFER = 100_000


def serialize(t: Txn, accounts: dict[int, Account]) -> dict:
    a = accounts[t.account_id]
    return {
        "id": t.id,
        "occurred_at": t.occurred_at,
        "amount": t.amount,
        "currency": t.currency,
        "merchant": t.merchant,
        "title": t.title,
        "account": {"id": a.id, "name": a.label or a.name, "kind": a.kind},
        "kind": t.kind,
        "category": t.category,
        "src": {"type": t.src_type, "cat": t.src_cat, "sub": t.src_sub},
        "rule_id": t.rule_id,
        "trip_id": t.trip_id,
        "dup_of_id": t.dup_of_id,
        "note": t.note,
        "reviewed": t.reviewed,
        "source": t.source,
        "provisional": t.provisional,
        "claim_id": t.claim_id,
        "funded_by": t.funded_by,
        "fx": {"currency": t.fx_currency, "amount": t.fx_amount, "fee": t.fee} if t.fx_currency or t.fee else None,
        "ai": _ai(t),
        "locked": {
            "kind": t.kind_locked, "category": t.category_locked,
            "trip": t.trip_locked, "dup": t.dup_locked,
        },
    }


def _ai(t: Txn) -> dict | None:
    if not t.ai_category:
        return None
    conf, _, reason = (t.ai_reason or "").partition("|")
    return {"category": t.ai_category, "confidence": conf or None, "reason": reason or None}


def accounts_by_id(session: Session) -> dict[int, Account]:
    return {a.id: a for a in session.exec(select(Account)).all()}


# ---------- review queues ----------

def cond_uncategorized():
    return (Txn.kind == "expense") & col(Txn.category).in_(VAGUE_CATEGORIES) & (
        col(Txn.dup_of_id).is_(None)
    )


def cond_dups():
    return col(Txn.dup_of_id).is_not(None)


# Charging my own pay wallet isn't money leaving me.
OWN_WALLETS = ("카카오페이", "네이버페이", "토스", "페이코")


def cond_big_transfers():
    return (
        (Txn.kind == "transfer") & (Txn.src_cat != "내계좌이체") & (Txn.amount <= -BIG_TRANSFER)
        & col(Txn.merchant).not_in(OWN_WALLETS)
    )


VIEWS = {
    "uncategorized": cond_uncategorized,
    "dups": cond_dups,
    "big_transfers": cond_big_transfers,
}


def review_counts(session: Session) -> dict[str, int]:
    out = {}
    for name, cond in VIEWS.items():
        q = select(func.count()).select_from(Txn).where(cond(), Txn.reviewed == False)
        out[name] = session.exec(q).one()
    out["total"] = sum(out.values())
    return out


@router.get("/transactions")
def list_transactions(
    session: SessionDep,
    start: date | None = None,
    end: date | None = None,
    category: str | None = None,
    kind: str | None = None,
    account_id: int | None = None,
    trip_id: int | None = None,
    q: str | None = None,
    view: str = "all",  # all | review | uncategorized | dups | big_transfers | live
    include_dups: bool = False,
    limit: int = Query(100, le=1000),
    offset: int = 0,
) -> dict:
    conds = []
    if start:
        conds.append(Txn.occurred_at >= datetime.combine(start, datetime.min.time()))
    if end:
        conds.append(Txn.occurred_at < datetime.combine(end + timedelta(days=1), datetime.min.time()))
    if category:
        # A 대분류 includes its 소분류; several can be given comma-separated.
        names = set().union(*(family(c.strip()) for c in category.split(",") if c.strip()))
        conds.append(col(Txn.category).in_(names))
    if kind:
        conds.append(Txn.kind == kind)
    if account_id:
        conds.append(Txn.account_id == account_id)
    if trip_id is not None:
        conds.append(col(Txn.trip_id).is_(None) if trip_id == 0 else Txn.trip_id == trip_id)
    if q:
        conds.append(or_(col(Txn.merchant).contains(q), col(Txn.title).contains(q), col(Txn.note).contains(q)))
    if view == "live":
        conds.append(Txn.provisional == True)
        conds.append(col(Txn.dup_of_id).is_(None))
    elif view == "review":
        conds.append(or_(*(c() for c in VIEWS.values())))
        conds.append(Txn.reviewed == False)
    elif view in VIEWS:
        conds.append(VIEWS[view]())
        conds.append(Txn.reviewed == False)
    elif not include_dups:
        conds.append(col(Txn.dup_of_id).is_(None))

    total = session.exec(select(func.count()).select_from(Txn).where(*conds)).one()
    spending = session.exec(
        select(func.coalesce(func.sum(Txn.amount), 0)).where(
            *conds, Txn.kind == "expense", col(Txn.dup_of_id).is_(None)
        )
    ).one()
    rows = session.exec(
        select(Txn).where(*conds).order_by(col(Txn.occurred_at).desc(), col(Txn.id).desc())
        .offset(offset).limit(limit)
    ).all()
    accounts = accounts_by_id(session)
    return {
        "items": [serialize(t, accounts) for t in rows],
        "total": total,
        "spending": -spending,
    }


# ---------- edits ----------

class TxnPatch(BaseModel):
    kind: str | None = None
    category: str | None = None
    trip_id: int | None = None  # send null to detach from a trip
    title: str | None = Field(default=None, max_length=80)
    note: str | None = None
    reviewed: bool | None = None
    not_duplicate: bool | None = None
    reset: bool | None = None  # forget every hand edit and re-derive
    claim_id: int | None = None  # send null to take the row out of its 정산
    fx_currency: str | None = None  # send null to clear the overseas details
    fx_amount: float | None = None
    fee: int | None = None


def _apply(session: Session, t: Txn, p: TxnPatch) -> None:
    fields = p.model_fields_set
    if p.reset:
        t.kind_locked = t.category_locked = t.trip_locked = t.dup_locked = False
        t.reviewed = False
    if p.kind is not None:
        if p.kind not in KINDS:
            raise HTTPException(400, f"알 수 없는 종류: {p.kind}")
        t.kind, t.kind_locked = p.kind, True
    if p.category is not None:
        if not session.get(Category, p.category):
            raise HTTPException(400, f"없는 카테고리: {p.category}")
        t.category, t.category_locked = p.category, True
        if t.kind != "expense" and t.kind != "income" and p.kind is None:
            # Giving a transfer a spending category means "this was actually spending".
            t.kind, t.kind_locked = "expense", True
    if "trip_id" in fields:
        t.trip_id, t.trip_locked = p.trip_id, True
    if "title" in fields:
        t.title = (p.title or "").strip() or None
    if "note" in fields:
        t.note = p.note or None
    if "claim_id" in fields:
        if p.claim_id is not None and not session.get(Claim, p.claim_id):
            raise HTTPException(400, "정산을 찾을 수 없어요.")
        t.claim_id = p.claim_id
    if "fx_currency" in fields:
        t.fx_currency = (p.fx_currency or "").strip().upper()[:3] or None
        if not t.fx_currency:
            t.fx_amount = None
    if "fx_amount" in fields:
        t.fx_amount = p.fx_amount
    if "fee" in fields:
        t.fee = p.fee or None
    if p.not_duplicate is not None:
        t.dup_locked = p.not_duplicate
        if p.not_duplicate:
            t.dup_of_id = None
    if p.reviewed is not None:
        t.reviewed = p.reviewed
    session.add(t)


@router.patch("/transactions/{txn_id}")
def patch_transaction(txn_id: int, body: TxnPatch, session: SessionDep) -> dict:
    t = session.get(Txn, txn_id)
    if not t:
        raise HTTPException(404, "거래를 찾을 수 없어요.")
    _apply(session, t, body)
    session.commit()
    reprocess(session)
    session.refresh(t)
    return serialize(t, accounts_by_id(session))


class BulkPatch(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=2000)
    patch: TxnPatch


@router.post("/transactions/bulk")
def bulk_patch(body: BulkPatch, session: SessionDep) -> dict:
    rows = session.exec(select(Txn).where(col(Txn.id).in_(body.ids))).all()
    for t in rows:
        _apply(session, t, body.patch)
    session.commit()
    reprocess(session)
    return {"updated": len(rows)}


class MakeRule(BaseModel):
    pattern: str | None = None  # default: the merchant text, escaped
    set_category: str | None = None
    set_kind: str | None = None
    name: str | None = None


@router.post("/transactions/{txn_id}/rule")
def make_rule(txn_id: int, body: MakeRule, session: SessionDep) -> dict:
    t = session.get(Txn, txn_id)
    if not t:
        raise HTTPException(404, "거래를 찾을 수 없어요.")
    if not body.set_category and not body.set_kind:
        raise HTTPException(400, "카테고리나 종류 중 하나는 정해 주세요.")
    pattern = body.pattern or re.escape(t.merchant)
    try:
        re.compile(pattern)
    except re.error as e:
        raise HTTPException(400, f"패턴 오류: {e}") from e
    rule = Rule(
        name=body.name or t.merchant, pattern=pattern, set_category=body.set_category,
        set_kind=body.set_kind, priority=1, created_at=datetime.now(),
    )
    session.add(rule)
    # The rule now owns this row's label.
    t.kind_locked = t.category_locked = False
    session.add(t)
    session.commit()
    reprocess(session)
    matched = session.exec(select(func.count()).select_from(Txn).where(Txn.rule_id == rule.id)).one()
    return {"rule_id": rule.id, "matched": matched}
