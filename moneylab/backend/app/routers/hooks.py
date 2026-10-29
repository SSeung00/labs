"""Live payment notifications from the phone (MacroDroid / Tasker → HTTP POST).

The endpoint sits outside the PIN lock (an automation app can't hold a session cookie), so it
requires its own random token and only ever *adds* provisional rows.
"""

import hashlib
import hmac
import json
import secrets
from datetime import datetime

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session, col, select

from app.db import SessionDep
from app.engine import notify
from app.engine.budget import get_setting, put_setting
from app.engine.pipeline import reprocess
from app.models import Account, NotifyLog, Txn

router = APIRouter(tags=["hooks"])

TOKEN_KEY = "notify.token"
MAP_KEY = "notify.accounts"  # {issuer: account_id}
PAY_ACCOUNT_HINT = {"카카오페이": "카카오페이 간편결제", "네이버페이": "네이버페이 간편결제", "페이코": "페이코 간편결제"}


def _token(session: Session) -> str:
    tok = get_setting(session, TOKEN_KEY)
    if not tok:
        tok = secrets.token_urlsafe(24)
        put_setting(session, TOKEN_KEY, tok)
        session.commit()
    return tok


def _mapping(session: Session) -> dict[str, int]:
    try:
        return {k: int(v) for k, v in json.loads(get_setting(session, MAP_KEY, "{}") or "{}").items()}
    except (ValueError, json.JSONDecodeError):
        return {}


def resolve_account(session: Session, issuer: str | None) -> Account | None:
    if not issuer:
        return None
    mapped = _mapping(session).get(issuer)
    if mapped and (acc := session.get(Account, mapped)):
        return acc
    if issuer in PAY_ACCOUNT_HINT:
        acc = session.exec(select(Account).where(Account.name == PAY_ACCOUNT_HINT[issuer])).first()
        if acc:
            return acc
    cards = session.exec(
        select(Account).where(Account.issuer == issuer, col(Account.kind).in_(("card", "check_card")))
    ).all()
    if not cards:
        return None
    # Several cards from one issuer: the one used most recently.
    last = {
        a.id: session.exec(
            select(Txn.occurred_at).where(Txn.account_id == a.id).order_by(col(Txn.occurred_at).desc())
        ).first() or datetime(1970, 1, 1)
        for a in cards
    }
    return max(cards, key=lambda a: last[a.id])


class NotifyIn(BaseModel):
    app: str = ""
    title: str = ""
    text: str = ""


def _log(session: Session, body: NotifyIn, status: str, detail: str | None = None,
         txn_id: int | None = None) -> None:
    session.add(NotifyLog(
        received_at=datetime.now(), app=body.app[:80], title=body.title[:200], text=body.text[:1000],
        status=status, detail=detail, txn_id=txn_id,
    ))
    session.commit()


@router.post("/hooks/notify")
async def receive(
    request: Request,
    session: SessionDep,
    token: str | None = None,
    x_moneylab_token: str | None = Header(default=None),
) -> dict:
    given = x_moneylab_token or token or ""
    if not hmac.compare_digest(given, _token(session)):
        raise HTTPException(401, "토큰이 맞지 않아요.")
    try:
        if "json" in request.headers.get("content-type", ""):
            body = NotifyIn(**(await request.json()))
        else:
            form = await request.form()
            body = NotifyIn(**{k: str(v) for k, v in form.items() if k in ("app", "title", "text")})
    except Exception as e:
        raise HTTPException(400, "app / title / text 형식으로 보내 주세요.") from e

    parsed = notify.parse(body.app, body.title, body.text)
    if not parsed:
        _log(session, body, "ignored", "금액이 없거나 결제 알림이 아니에요")
        return {"status": "ignored"}
    acc = resolve_account(session, parsed.issuer)
    if not acc:
        _log(session, body, "error", f"'{parsed.issuer or '알 수 없음'}' 카드와 연결된 계좌가 없어요")
        return {"status": "unmatched", "issuer": parsed.issuer}

    key = hashlib.sha1(f"notify|{body.app}|{body.title}|{body.text}".encode()).hexdigest()
    if session.exec(select(Txn).where(Txn.base_key == key)).first():
        _log(session, body, "duplicate")
        return {"status": "duplicate"}
    t = Txn(
        account_id=acc.id, occurred_at=parsed.occurred_at, amount=parsed.amount,
        merchant=parsed.merchant, src_type="지출", base_key=key, occurrence=1,
        source="notify", provisional=True,
        src_memo=f"{parsed.installment}개월 할부" if parsed.installment else None,
    )
    session.add(t)
    session.commit()
    reprocess(session)
    session.refresh(t)
    _log(session, body, "added", f"{acc.label or acc.name} · {parsed.merchant} · {parsed.amount:,}원", t.id)
    return {"status": "added", "txn_id": t.id, "superseded": t.dup_of_id is not None}


# ---------- settings (local or PIN-unlocked only) ----------

@router.get("/hooks/notify/status")
def status(session: SessionDep) -> dict:
    logs = session.exec(select(NotifyLog).order_by(col(NotifyLog.id).desc()).limit(20)).all()
    pending = session.exec(
        select(Txn).where(Txn.provisional == True, col(Txn.dup_of_id).is_(None))
    ).all()
    return {
        "token": _token(session),
        "path": "/api/hooks/notify",
        "mapping": _mapping(session),
        "pending": len(pending),
        "pending_amount": -sum(t.amount for t in pending),
        "logs": logs,
    }


@router.post("/hooks/notify/rotate")
def rotate(session: SessionDep) -> dict:
    put_setting(session, TOKEN_KEY, secrets.token_urlsafe(24))
    session.commit()
    return {"token": _token(session)}


class MappingIn(BaseModel):
    mapping: dict[str, int | None]


@router.put("/hooks/notify/accounts")
def put_mapping(body: MappingIn, session: SessionDep) -> dict:
    clean = {k: v for k, v in body.mapping.items() if v}
    put_setting(session, MAP_KEY, json.dumps(clean, ensure_ascii=False))
    session.commit()
    return {"mapping": clean}


class TestIn(BaseModel):
    app: str = ""
    title: str = ""
    text: str


@router.post("/hooks/notify/test")
def test_parse(body: TestIn, session: SessionDep) -> dict:
    """Show how a notification would be read, without saving anything."""
    p = notify.parse(body.app, body.title, body.text)
    if not p:
        return {"ok": False}
    acc = resolve_account(session, p.issuer)
    return {
        "ok": True, "amount": p.amount, "occurred_at": p.occurred_at, "merchant": p.merchant,
        "issuer": p.issuer, "account": (acc.label or acc.name) if acc else None,
    }
