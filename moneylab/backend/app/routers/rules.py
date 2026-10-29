import re
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlmodel import col, select

from app.db import SessionDep
from app.engine.pipeline import reprocess
from app.models import ACCOUNT_KINDS, KINDS, Account, Rule, Txn

router = APIRouter(tags=["rules"])


class RuleIn(BaseModel):
    name: str = ""
    pattern: str = Field(min_length=1, max_length=2000)
    account_kind: str | None = None
    set_category: str | None = None
    set_kind: str | None = None
    priority: int = 1
    enabled: bool = True

    @field_validator("pattern")
    @classmethod
    def _regex(cls, v: str) -> str:
        try:
            re.compile(v)
        except re.error as e:
            raise ValueError(f"패턴 오류: {e}") from e
        return v

    @field_validator("set_kind")
    @classmethod
    def _kind(cls, v: str | None) -> str | None:
        if v and v not in KINDS:
            raise ValueError(f"알 수 없는 종류: {v}")
        return v or None

    @field_validator("account_kind")
    @classmethod
    def _akind(cls, v: str | None) -> str | None:
        if v and v not in ACCOUNT_KINDS:
            raise ValueError(f"알 수 없는 계좌 종류: {v}")
        return v or None


@router.get("/rules")
def list_rules(session: SessionDep) -> list[dict]:
    counts = dict(
        session.exec(
            select(Txn.rule_id, func.count()).where(col(Txn.rule_id).is_not(None)).group_by(Txn.rule_id)
        ).all()
    )
    rules = session.exec(select(Rule).order_by(Rule.priority, Rule.id)).all()
    return [{**r.model_dump(), "matched": counts.get(r.id, 0)} for r in rules]


@router.post("/rules")
def create_rule(body: RuleIn, session: SessionDep) -> dict:
    if not body.set_category and not body.set_kind:
        raise HTTPException(400, "카테고리나 종류 중 하나는 정해 주세요.")
    r = Rule(**body.model_dump(), created_at=datetime.now())
    session.add(r)
    session.commit()
    reprocess(session)
    session.refresh(r)
    return r.model_dump()


@router.put("/rules/{rule_id}")
def update_rule(rule_id: int, body: RuleIn, session: SessionDep) -> dict:
    r = session.get(Rule, rule_id)
    if not r:
        raise HTTPException(404, "규칙을 찾을 수 없어요.")
    for k, v in body.model_dump().items():
        setattr(r, k, v)
    session.add(r)
    session.commit()
    reprocess(session)
    session.refresh(r)
    return r.model_dump()


@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int, session: SessionDep) -> dict:
    r = session.get(Rule, rule_id)
    if not r:
        raise HTTPException(404, "규칙을 찾을 수 없어요.")
    session.delete(r)
    session.commit()
    reprocess(session)
    return {"ok": True}


class PreviewIn(BaseModel):
    pattern: str
    account_kind: str | None = None


@router.post("/rules/preview")
def preview(body: PreviewIn, session: SessionDep) -> dict:
    """Which merchants a pattern would catch (spending rows only)."""
    try:
        regex = re.compile(body.pattern, re.IGNORECASE)
    except re.error as e:
        raise HTTPException(400, f"패턴 오류: {e}") from e
    kinds = {a.id: a.kind for a in session.exec(select(Account)).all()}
    merchants: dict[str, list[int]] = {}
    for t in session.exec(select(Txn).where(Txn.kind == "expense")).all():
        if body.account_kind and kinds[t.account_id] != body.account_kind:
            continue
        if regex.search(t.merchant):
            m = merchants.setdefault(t.merchant, [0, 0])
            m[0] += 1
            m[1] -= t.amount
    top = sorted(merchants.items(), key=lambda kv: -kv[1][0])[:20]
    return {
        "count": sum(v[0] for v in merchants.values()),
        "merchants": [{"merchant": k, "count": v[0], "amount": v[1]} for k, v in top],
    }
