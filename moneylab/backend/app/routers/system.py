import threading

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import col, select

from app import auth, desktop
from app.db import SessionDep
from app.models import ImportBatch, Txn
from app.routers.transactions import review_counts

router = APIRouter(tags=["system"])


@router.get("/health")
def health(request: Request, session: SessionDep) -> dict:
    out: dict = {"status": "ok"}
    # Open path: a locked phone only learns that the server is up.
    if not (auth.is_local(request.scope) or auth.remote_authed(request.scope)):
        return out
    txns = session.exec(select(func.count()).select_from(Txn)).one()
    last = session.exec(select(ImportBatch).order_by(col(ImportBatch.id).desc())).first()
    live = session.exec(
        select(func.count()).select_from(Txn).where(Txn.provisional == True, col(Txn.dup_of_id).is_(None))
    ).one()
    return {
        **out,
        "txns": txns,
        "last_import": last.imported_at if last else None,
        "data_until": last.period_end if last else None,
        "review": review_counts(session)["total"],
        "live": live,
    }


def _local_only(request: Request) -> None:
    if not auth.is_local(request.scope):
        raise HTTPException(403, "PC에서만 바꿀 수 있어요.")


@router.get("/system/service")
def service_status() -> dict:
    """How MoneyLab runs on this PC: background service, start at log-in, current web build."""
    return desktop.status()


@router.post("/system/restart")
def restart(request: Request) -> dict:
    _local_only(request)
    if desktop.control("status") is None:
        raise HTTPException(400, "백그라운드 서비스로 실행 중이 아니에요. 창을 닫고 다시 실행해 주세요.")
    # Reply first; the service stops this process a moment later and starts a fresh one.
    threading.Timer(0.5, desktop.control, args=("restart",)).start()
    return {"ok": True}


class AutostartBody(BaseModel):
    enabled: bool


@router.put("/system/autostart")
def autostart(body: AutostartBody, request: Request) -> dict:
    _local_only(request)
    try:
        desktop.set_autostart(body.enabled)
    except OSError as e:
        raise HTTPException(500, str(e)) from e
    return desktop.status()


@router.post("/system/shortcuts")
def shortcuts(request: Request) -> dict:
    _local_only(request)
    try:
        made = desktop.make_app_shortcuts()
    except OSError as e:
        raise HTTPException(500, str(e)) from e
    return {**desktop.status(), "made": made}
