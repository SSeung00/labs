"""Recurring payments, balance checks, backups, running costs, data range."""

from datetime import date
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from app import auth
from app.db import SessionDep
from app.engine import backup as BK
from app.engine import balancecheck as BC
from app.engine import card_statement as CS
from app.engine import recurring as R
from app.engine import running as RUN
from app.engine import statement as ST
from app.engine.budget import put_setting
from app.engine.ledger import ledger_start, set_ledger_start
from app.ingest.banksalad import ExportFormatError
from app.models import Account, BalanceCheck

router = APIRouter(tags=["tools"])


# ---------- data range ----------

@router.get("/ledger")
def get_ledger(session: SessionDep) -> dict:
    return {"start": ledger_start(session)}


class LedgerIn(BaseModel):
    start: date | None = None


@router.put("/ledger")
def put_ledger(body: LedgerIn, session: SessionDep) -> dict:
    """Set where the ledger starts: earlier rows are deleted and later imports skip them."""
    return set_ledger_start(session, body.start)


# ---------- recurring ----------

@router.get("/recurring")
def recurring(session: SessionDep, include_ignored: bool = False) -> dict:
    items = R.detect(session, include_ignored=include_ignored)
    active = [i for i in items if i["active"] and not i["ignored"]]
    return {
        "items": items,
        "monthly_total": sum(i["monthly_cost"] for i in active),
        "yearly_total": sum(i["yearly_cost"] for i in active),
        "upcoming": R.upcoming([i for i in items if not i["ignored"]]),
    }


class IgnoreIn(BaseModel):
    key: str
    ignored: bool = True


@router.post("/recurring/ignore")
def ignore(body: IgnoreIn, session: SessionDep) -> dict:
    R.set_ignored(session, body.key, body.ignored)
    return {"ok": True}


# ---------- balance checks ----------

@router.get("/checks/{account_id}")
def check_report(account_id: int, session: SessionDep) -> dict:
    try:
        return BC.report(session, account_id)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e


class CheckIn(BaseModel):
    account_id: int
    on_date: date
    amount: int
    note: str | None = None


@router.post("/checks")
def add_check(body: CheckIn, session: SessionDep) -> dict:
    if not session.get(Account, body.account_id):
        raise HTTPException(404, "계좌를 찾을 수 없어요.")
    BC.add_check(session, body.account_id, body.on_date, body.amount, body.note)
    return BC.report(session, body.account_id)


@router.delete("/checks/{check_id}")
def delete_check(check_id: int, session: SessionDep) -> dict:
    c = session.get(BalanceCheck, check_id)
    if not c:
        raise HTTPException(404, "기록을 찾을 수 없어요.")
    aid = c.account_id
    session.delete(c)
    session.commit()
    return BC.report(session, aid)


@router.post("/checks/statement")
async def check_statement(session: SessionDep, file: UploadFile, account_id: Annotated[int, Form()]) -> dict:
    """Compare a bank statement (거래내역 엑셀) with MoneyLab, row by row."""
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(400, "파일이 너무 커요 (20MB 초과).")
    try:
        result = ST.reconcile(session, account_id, data, file.filename or "statement")
    except ExportFormatError as e:
        session.rollback()
        raise HTTPException(400, str(e)) from e
    result["report"] = BC.report(session, account_id)
    return result


# ---------- backups ----------

@router.post("/checks/card-statements")
async def card_statements(session: SessionDep, files: list[UploadFile], apply: Annotated[bool, Form()] = False) -> dict:
    """Card company statements (삼성 .xlsx / 현대 .xls) against the card rows; apply=true books
    what only the statements have (missing lines, fees, overseas settlement difference)."""
    try:
        sts = [CS.parse(await f.read(), f.filename or "statement") for f in files]
    except ExportFormatError as e:
        raise HTTPException(400, str(e)) from e
    if apply:
        return CS.adjust(session, sts)
    return {"added": [], "report": CS.reconcile(session, sts)}


@router.get("/backup")
def backup_status(session: SessionDep) -> dict:
    return BK.status(session)


@router.post("/backup/run")
def backup_now(session: SessionDep) -> dict:
    try:
        return BK.create_backup(session)
    except OSError as e:
        raise HTTPException(400, f"백업 폴더에 쓸 수 없어요: {e}") from e


class BackupSettings(BaseModel):
    dir: str | None = Field(default=None, max_length=500)


@router.put("/backup/settings")
def backup_settings(body: BackupSettings, request: Request, session: SessionDep) -> dict:
    if not auth.is_local(request.scope):
        raise HTTPException(403, "백업 폴더는 PC에서만 바꿀 수 있어요.")
    if body.dir:
        p = Path(body.dir).expanduser()
        try:
            p.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            raise HTTPException(400, f"폴더를 만들 수 없어요: {e}") from e
    put_setting(session, BK.DIR_KEY, body.dir or None)
    session.commit()
    return BK.status(session)


@router.get("/backup/key")
def backup_key(request: Request) -> dict:
    """The recovery key, only to this PC's own browser (never over the phone link)."""
    if not auth.is_local(request.scope):
        raise HTTPException(403, "복구 키는 PC에서만 볼 수 있어요.")
    return {"key": BK.load_key().decode(), "file": str(BK.KEY_FILE)}


# ---------- running ----------

@router.get("/running")
def running(session: SessionDep) -> dict:
    return RUN.overview(session)


class LinkIn(BaseModel):
    txn_id: int
    gear_id: int | None = None
    race_id: int | None = None


@router.put("/running/link")
def running_link(body: LinkIn, session: SessionDep) -> dict:
    RUN.set_link(session, body.txn_id, body.gear_id, body.race_id)
    return RUN.overview(session)


