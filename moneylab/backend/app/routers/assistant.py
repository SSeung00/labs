import hashlib
import uuid
from datetime import date, datetime

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlmodel import col, select

from app.db import SessionDep
from app.engine import assistant as A
from app.engine.claude import AIError
from app.engine.pipeline import reprocess
from app.models import ACCOUNT_KINDS, Account, Category, Report, Txn
from app.routers.transactions import accounts_by_id, serialize

router = APIRouter(tags=["assistant"])

MAX_IMAGE = 8 * 1024 * 1024


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    history: list[dict] = []


@router.post("/ai/ask")
def ask(body: AskIn, session: SessionDep) -> dict:
    try:
        return A.ask(session, body.question, body.history)
    except AIError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/ai/reports")
def make_report(session: SessionDep, month: str | None = None) -> Report:
    month = month or date.today().strftime("%Y-%m")
    try:
        return A.make_report(session, month)
    except AIError as e:
        raise HTTPException(400, str(e)) from e


@router.get("/ai/reports")
def list_reports(session: SessionDep) -> list[dict]:
    rows = session.exec(select(Report).order_by(col(Report.id).desc()).limit(36)).all()
    return [{"id": r.id, "month": r.month, "created_at": r.created_at, "model": r.model,
             "input_tokens": r.input_tokens, "output_tokens": r.output_tokens} for r in rows]


@router.get("/ai/reports/{rid}")
def get_report(rid: int, session: SessionDep) -> Report:
    r = session.get(Report, rid)
    if not r:
        raise HTTPException(404, "리포트를 찾을 수 없어요.")
    return r


@router.delete("/ai/reports/{rid}")
def delete_report(rid: int, session: SessionDep) -> dict:
    r = session.get(Report, rid)
    if r:
        session.delete(r)
        session.commit()
    return {"ok": True}


@router.post("/ai/receipts")
async def read_receipts(files: list[UploadFile], session: SessionDep) -> dict:
    if not files or len(files) > 5:
        raise HTTPException(400, "사진은 1~5장까지 올려 주세요.")
    images = []
    for f in files:
        data = await f.read()
        media = (f.content_type or "").lower()
        if media == "image/jpg":
            media = "image/jpeg"
        if media not in A.IMAGE_TYPES:
            raise HTTPException(400, f"{f.filename}: JPG·PNG·WEBP 사진만 읽을 수 있어요.")
        if len(data) > MAX_IMAGE:
            raise HTTPException(400, f"{f.filename}: 8MB보다 작은 사진으로 올려 주세요.")
        images.append((data, media))
    try:
        return {"items": A.read_receipts(session, images)}
    except AIError as e:
        raise HTTPException(400, str(e)) from e


# ---------- hand-entered transactions ----------

class ManualIn(BaseModel):
    account_id: int
    occurred_at: datetime
    amount: int  # negative = spending
    merchant: str = Field(min_length=1, max_length=120)
    category: str | None = None
    note: str | None = None
    fx_currency: str | None = None
    fx_amount: float | None = None


@router.post("/transactions/manual")
def create_manual(items: list[ManualIn], session: SessionDep) -> dict:
    if not items or len(items) > 50:
        raise HTTPException(400, "1~50건까지 한 번에 넣을 수 있어요.")
    cats = {c.name for c in session.exec(select(Category)).all()}
    ids = []
    for it in items:
        acc = session.get(Account, it.account_id)
        if not acc:
            raise HTTPException(400, "계좌를 찾을 수 없어요.")
        key = hashlib.sha1(f"manual|{uuid.uuid4()}".encode()).hexdigest()
        t = Txn(
            account_id=acc.id, occurred_at=it.occurred_at, amount=it.amount, merchant=it.merchant.strip(),
            src_type="지출" if it.amount < 0 else "수입", base_key=key, occurrence=1, source="manual",
            # On a connected card/bank the same payment will arrive in an export and replace this.
            provisional=acc.kind != "cash", note=it.note or None,
            fx_currency=(it.fx_currency or None) and it.fx_currency.upper(), fx_amount=it.fx_amount,
        )
        if it.category and it.category in cats:
            t.category, t.category_locked = it.category, True
            t.kind, t.kind_locked = "expense", True
        session.add(t)
        session.flush()
        ids.append(t.id)
    session.commit()
    reprocess(session)
    accounts = accounts_by_id(session)
    rows = session.exec(select(Txn).where(col(Txn.id).in_(ids))).all()
    return {"items": [serialize(t, accounts) for t in rows]}


@router.delete("/transactions/{txn_id}")
def delete_txn(txn_id: int, session: SessionDep) -> dict:
    t = session.get(Txn, txn_id)
    if not t:
        raise HTTPException(404, "거래를 찾을 수 없어요.")
    if t.source not in ("manual", "notify"):
        raise HTTPException(400, "엑셀에서 온 거래는 지울 수 없어요. 종류를 '이체'로 바꾸거나 중복으로 표시하세요.")
    session.delete(t)
    session.commit()
    reprocess(session)
    return {"ok": True}


class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    kind: str = "cash"


@router.post("/accounts")
def create_account(body: AccountIn, session: SessionDep) -> dict:
    if body.kind not in ACCOUNT_KINDS:
        raise HTTPException(400, f"알 수 없는 계좌 종류: {body.kind}")
    if session.exec(select(Account).where(Account.name == body.name.strip())).first():
        raise HTTPException(400, "같은 이름의 계좌가 있어요.")
    a = Account(name=body.name.strip(), kind=body.kind)
    session.add(a)
    session.commit()
    session.refresh(a)
    return a.model_dump()
