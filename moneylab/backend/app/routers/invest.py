"""Investing: holdings, allocation vs. the user's own targets, contributions, policy notes.

The app tracks and does arithmetic; targets and assumptions are always the user's input.
"""

import json
from collections import defaultdict
from datetime import date, datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, col, select

from app.db import SessionDep
from app.engine.budget import (
    add_months,
    get_setting,
    invest_by_account,
    month_end,
    month_start,
    put_setting,
    ym,
)
from app.ingest.service import snapshot_holdings
from app.models import ASSET_CLASSES, BalanceSnapshot, Holding, HoldingSnapshot

router = APIRouter(tags=["invest"])

TARGETS_KEY = "invest.targets"
POLICY_KEY = "invest.policy"
INVEST_GROUP_HINTS = ("투자",)


def _json_setting(session: Session, key: str, default):
    try:
        return json.loads(get_setting(session, key, "") or "") or default
    except json.JSONDecodeError:
        return default


@router.get("/invest")
def overview(session: SessionDep) -> dict:
    holdings = session.exec(select(Holding).order_by(col(Holding.value).desc())).all()
    cost = sum(h.cost for h in holdings)
    value = sum(h.value for h in holdings)
    targets: dict[str, float] = _json_setting(session, TARGETS_KEY, {})

    by_class: dict[str, int] = defaultdict(int)
    for h in holdings:
        by_class[h.asset_class] += h.value
    classes = []
    for c in ASSET_CLASSES:
        v = by_class.get(c, 0)
        t = float(targets.get(c, 0) or 0)
        if not v and not t:
            continue
        pct = v / value if value else 0
        classes.append({
            "asset_class": c, "value": v, "pct": pct, "target_pct": t / 100 if t else None,
            "diff": round(value * t / 100 - v) if t and value else None,
        })

    current = ym(date.today())
    contributions = []
    for i in range(23, -1, -1):
        m = add_months(current, -i)
        contributions.append({"month": m, "amount": sum(invest_by_account(session, month_start(m), month_end(m)).values())})

    # Investment-type balances from Banksalad's 재무현황 (accounts even without holdings detail)
    as_of = session.exec(select(BalanceSnapshot.as_of).order_by(col(BalanceSnapshot.as_of).desc())).first()
    accounts = []
    if as_of:
        for b in session.exec(select(BalanceSnapshot).where(BalanceSnapshot.as_of == as_of)).all():
            if any(h in b.group for h in INVEST_GROUP_HINTS):
                accounts.append({"name": b.name, "amount": b.amount, "group": b.group})

    snaps = session.exec(select(HoldingSnapshot).order_by(HoldingSnapshot.as_of)).all()
    return {
        "holdings": holdings,
        "totals": {"cost": cost, "value": value, "gain": value - cost, "gain_pct": (value - cost) / cost if cost else None},
        "classes": classes,
        "targets": targets,
        "asset_classes": list(ASSET_CLASSES),
        "contributions": contributions,
        "accounts": {"as_of": as_of, "items": accounts},
        "snapshots": [{"as_of": s.as_of, "cost": s.cost, "value": s.value} for s in snaps],
        "policy": _json_setting(session, POLICY_KEY, {}),
    }


class HoldingIn(BaseModel):
    account: str = ""
    name: str = Field(min_length=1, max_length=80)
    ticker: str | None = None
    asset_class: str = "기타"
    quantity: float | None = None
    cost: int = Field(ge=0)
    value: int = Field(ge=0)
    note: str | None = None


def _save(session: Session, h: Holding, body: HoldingIn) -> Holding:
    if body.asset_class not in ASSET_CLASSES:
        raise HTTPException(400, f"알 수 없는 자산군: {body.asset_class}")
    for k, v in body.model_dump().items():
        setattr(h, k, v)
    h.updated_at = datetime.now()
    session.add(h)
    session.flush()
    snapshot_holdings(session, date.today())
    session.commit()
    session.refresh(h)
    return h


@router.post("/invest/holdings")
def create_holding(body: HoldingIn, session: SessionDep) -> Holding:
    return _save(session, Holding(name=body.name), body)


@router.put("/invest/holdings/{hid}")
def update_holding(hid: int, body: HoldingIn, session: SessionDep) -> Holding:
    h = session.get(Holding, hid)
    if not h:
        raise HTTPException(404, "보유 자산을 찾을 수 없어요.")
    return _save(session, h, body)


@router.delete("/invest/holdings/{hid}")
def delete_holding(hid: int, session: SessionDep) -> dict:
    h = session.get(Holding, hid)
    if not h:
        raise HTTPException(404, "보유 자산을 찾을 수 없어요.")
    session.delete(h)
    session.flush()
    snapshot_holdings(session, date.today())
    session.commit()
    return {"ok": True}


class TargetsIn(BaseModel):
    targets: dict[str, float]


@router.put("/invest/targets")
def put_targets(body: TargetsIn, session: SessionDep) -> dict:
    clean = {k: round(v, 1) for k, v in body.targets.items() if k in ASSET_CLASSES and v > 0}
    if sum(clean.values()) > 100.01:
        raise HTTPException(400, "목표 비중 합계가 100%를 넘어요.")
    put_setting(session, TARGETS_KEY, json.dumps(clean, ensure_ascii=False))
    session.commit()
    return {"targets": clean}


class PolicyIn(BaseModel):
    goal: str = ""
    horizon: str = ""
    risk: str = ""
    rules: str = ""
    notes: str = ""


@router.put("/invest/policy")
def put_policy(body: PolicyIn, session: SessionDep) -> dict:
    data = {k: v[:2000] for k, v in body.model_dump().items()}
    data["updated_at"] = datetime.now().isoformat(timespec="minutes")
    put_setting(session, POLICY_KEY, json.dumps(data, ensure_ascii=False))
    session.commit()
    return data
