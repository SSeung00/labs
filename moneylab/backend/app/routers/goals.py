"""Goals: 여행 기금 같은 목표 금액과 청년도약계좌 같은 적금 상품."""

from datetime import date, datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import Session, col, select

from app.db import SessionDep
from app.engine.pipeline import reprocess
from app.models import ACCOUNT_KINDS, ISSUERS, Account, BalanceSnapshot, Goal, Txn

router = APIRouter(tags=["goals"])


def _months_between(a: date, b: date) -> int:
    return (b.year - a.year) * 12 + (b.month - a.month)


def account_balance(session: Session, account: Account) -> tuple[int | None, date | None]:
    """Latest 재무현황 balance plus savings movements after it."""
    snap = session.exec(
        select(BalanceSnapshot)
        .where(BalanceSnapshot.name == account.name, BalanceSnapshot.side == "asset")
        .order_by(col(BalanceSnapshot.as_of).desc())
    ).first()
    if not snap:
        return None, None
    after = session.exec(
        select(func.coalesce(func.sum(Txn.amount), 0)).where(
            Txn.account_id == account.id,
            Txn.occurred_at > datetime.combine(snap.as_of, datetime.max.time()),
        )
    ).one()
    return snap.amount + after, snap.as_of


def _deposits(session: Session, account_id: int) -> list[dict]:
    month = func.strftime("%Y-%m", Txn.occurred_at)
    rows = session.exec(
        select(month, func.sum(Txn.amount))
        .where(Txn.account_id == account_id, Txn.amount > 0)
        .group_by(month).order_by(month)
    ).all()
    return [{"month": m, "amount": a} for m, a in rows]


TAX = 0.154  # 일반과세 (이자소득세 14% + 지방소득세 1.4%)


def maturity(g: Goal) -> dict | None:
    """Rough 적금 payout: equal monthly deposits from start to maturity, simple interest.

    Each deposit earns rate × (months it stays) / 12; that sums to
    monthly × rate × n(n+1)/2 / 12. Banks count days and may pay 기여금 interest differently,
    so this is an estimate from the user's own inputs.
    """
    if g.kind != "savings" or not (g.start_date and g.target_date and g.monthly_amount):
        return None
    n = _months_between(g.start_date, g.target_date)
    if n <= 0:
        return None
    principal = g.monthly_amount * n
    rate = (g.rate or 0) / 100
    interest = round(g.monthly_amount * rate * n * (n + 1) / 2 / 12)
    tax = 0 if g.tax_free else round(interest * TAX)
    gov = (g.gov_monthly or 0) * n
    return {
        "months": n, "principal": principal, "interest": interest, "tax": tax, "gov": gov,
        "total": principal + interest - tax + gov,
    }


def goal_view(session: Session, g: Goal) -> dict:
    today = date.today()
    current, as_of, deposits = g.saved_manual, None, []
    account = session.get(Account, g.account_id) if g.account_id else None
    if account:
        bal, as_of = account_balance(session, account)
        if bal is not None:
            current = bal
        deposits = _deposits(session, account.id)
    months_left = _months_between(today, g.target_date) if g.target_date else None
    projected = None
    if current is not None and g.monthly_amount and months_left is not None:
        projected = current + g.monthly_amount * max(0, months_left)
    need_per_month = None
    if g.target_amount and current is not None and months_left and months_left > 0:
        need_per_month = max(0, round((g.target_amount - current) / months_left))
    return {
        **g.model_dump(),
        "maturity": maturity(g),
        "account_name": (account.label or account.name) if account else None,
        "current": current,
        "balance_as_of": as_of,
        "months_left": months_left,
        "projected": projected,
        "need_per_month": need_per_month,
        "progress": (current / g.target_amount) if g.target_amount and current is not None else None,
        "deposits": deposits[-24:],
    }


@router.get("/goals")
def list_goals(session: SessionDep) -> dict:
    goals = session.exec(select(Goal).order_by(Goal.sort, Goal.id)).all()
    linked = {g.account_id for g in goals if g.account_id}
    suggestions = []
    for a in session.exec(select(Account).where(Account.kind == "savings")).all():
        if a.id in linked:
            continue
        deposits = _deposits(session, a.id)
        amounts = sorted(d["amount"] for d in deposits)
        typical = amounts[len(amounts) // 2] if amounts else None
        bal, _ = account_balance(session, a)
        suggestions.append({"account_id": a.id, "name": a.label or a.name, "balance": bal,
                            "monthly_amount": typical})
    return {"goals": [goal_view(session, g) for g in goals], "suggestions": suggestions}


class GoalIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    kind: str = Field(default="fund", pattern="^(fund|savings)$")
    target_amount: int | None = Field(default=None, ge=0)
    target_date: date | None = None
    start_date: date | None = None
    monthly_amount: int | None = Field(default=None, ge=0)
    account_id: int | None = None
    saved_manual: int | None = None
    note: str | None = None
    rate: float | None = Field(default=None, ge=0, le=30)
    gov_monthly: int | None = Field(default=None, ge=0)
    tax_free: bool = True


@router.post("/goals")
def create_goal(body: GoalIn, session: SessionDep) -> dict:
    g = Goal(**body.model_dump())
    session.add(g)
    session.commit()
    session.refresh(g)
    return goal_view(session, g)


@router.put("/goals/{goal_id}")
def update_goal(goal_id: int, body: GoalIn, session: SessionDep) -> dict:
    g = session.get(Goal, goal_id)
    if not g:
        raise HTTPException(404, "목표를 찾을 수 없어요.")
    for k, v in body.model_dump().items():
        setattr(g, k, v)
    session.add(g)
    session.commit()
    return goal_view(session, g)


@router.delete("/goals/{goal_id}")
def delete_goal(goal_id: int, session: SessionDep) -> dict:
    g = session.get(Goal, goal_id)
    if not g:
        raise HTTPException(404, "목표를 찾을 수 없어요.")
    session.delete(g)
    session.commit()
    return {"ok": True}


class AccountPatch(BaseModel):
    kind: str | None = None
    label: str | None = None
    hidden: bool | None = None
    issuer: str | None = None
    funding_account_id: int | None = None


@router.patch("/accounts/{account_id}")
def patch_account(account_id: int, body: AccountPatch, session: SessionDep) -> dict:
    a = session.get(Account, account_id)
    if not a:
        raise HTTPException(404, "계좌를 찾을 수 없어요.")
    if body.kind is not None:
        if body.kind not in ACCOUNT_KINDS:
            raise HTTPException(400, f"알 수 없는 계좌 종류: {body.kind}")
        a.kind = body.kind
    if "label" in body.model_fields_set:
        a.label = body.label or None
    if body.hidden is not None:
        a.hidden = body.hidden
    if "issuer" in body.model_fields_set:
        if body.issuer and body.issuer not in ISSUERS:
            raise HTTPException(400, f"알 수 없는 카드사: {body.issuer}")
        a.issuer = body.issuer or None
    if "funding_account_id" in body.model_fields_set:
        if body.funding_account_id and body.funding_account_id == a.id:
            raise HTTPException(400, "자기 자신을 출금 통장으로 고를 수 없어요.")
        a.funding_account_id = body.funding_account_id or None
    session.add(a)
    session.commit()
    reprocess(session)
    session.refresh(a)
    return a.model_dump()
