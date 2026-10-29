import threading

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import func, select

from app import auth, desktop
from app.db import SessionDep
from app.models import Activity, DailyWellness

router = APIRouter(tags=["system"])


@router.get("/health")
def health(session: SessionDep) -> dict:
    activities = session.exec(select(func.count()).select_from(Activity)).one()
    wellness_days = session.exec(select(func.count()).select_from(DailyWellness)).one()
    return {"status": "ok", "activities": activities, "wellness_days": wellness_days}


@router.get("/ping")
def ping() -> dict:
    """Cheap reachability check (no DB). The offline banner polls it to notice the PC is back."""
    return {"ok": True}


def _local_only(request: Request) -> None:
    if not auth.is_local(request.scope):
        raise HTTPException(403, "PC에서만 바꿀 수 있어요.")


@router.get("/system/service")
def service_status() -> dict:
    """How RunLab is running on this PC: background service, start at log-in, current web build."""
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
