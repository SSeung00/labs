import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel

from app.db import SessionDep
from app.ingest import auto_sync
from app.ingest.garmin_auth import GarminAuthError, garmin_auth
from app.ingest.garmin_sync import get_state, sync_manager

router = APIRouter(tags=["garmin"])


class LoginBody(BaseModel):
    email: str
    password: str


class MfaBody(BaseModel):
    code: str


class SyncBody(BaseModel):
    full: bool = False
    wellness_days: int = 180


@router.get("/garmin/status")
def status(session: SessionDep) -> dict:
    s = garmin_auth.status()
    return {**s.__dict__, "last_sync": get_state(session, "last_sync")}


@router.post("/garmin/login")
def login(body: LoginBody) -> dict:
    try:
        return garmin_auth.login(body.email, body.password).__dict__
    except GarminAuthError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/garmin/mfa")
def mfa(body: MfaBody) -> dict:
    try:
        return garmin_auth.submit_mfa(body.code).__dict__
    except GarminAuthError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/garmin/logout")
def logout() -> dict:
    garmin_auth.logout()
    return {"connected": False}


@router.post("/sync/start")
def start_sync(body: SyncBody) -> dict:
    if not garmin_auth.status().connected:
        raise HTTPException(400, "가민 계정을 먼저 연결하세요.")
    if not sync_manager.start(full=body.full, wellness_days=max(7, min(body.wellness_days, 3650))):
        raise HTTPException(409, "이미 작업이 진행 중입니다.")
    return sync_manager.snapshot()


@router.get("/sync/status")
def sync_status() -> dict:
    return sync_manager.snapshot()


class AutoSyncBody(BaseModel):
    enabled: bool
    time: str  # "HH:MM"


@router.get("/sync/auto")
def get_auto_sync(session: SessionDep) -> dict:
    return auto_sync.status(session)


@router.put("/sync/auto")
def put_auto_sync(body: AutoSyncBody, session: SessionDep) -> dict:
    try:
        auto_sync.set_config(session, body.enabled, body.time)
    except ValueError as e:
        raise HTTPException(400, "시간은 HH:MM 형식으로 적어 주세요.") from e
    return auto_sync.status(session)


@router.post("/import/files")
async def import_files(files: list[UploadFile]) -> dict:
    """Accept .fit files or zips (single-activity or full Garmin account export)."""
    paths: list[Path] = []
    try:
        for f in files:
            suffix = Path(f.filename or "").suffix.lower()
            if suffix not in (".fit", ".zip"):
                continue
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, prefix="runlab-") as tmp:
                paths.append(Path(tmp.name))
                while chunk := await f.read(1 << 20):
                    tmp.write(chunk)
    except Exception:
        for p in paths:
            p.unlink(missing_ok=True)
        raise
    if not paths:
        raise HTTPException(400, ".fit 또는 .zip 파일을 올려 주세요.")
    if not sync_manager.start_import(paths):
        for p in paths:
            p.unlink(missing_ok=True)
        raise HTTPException(409, "이미 작업이 진행 중입니다.")
    return sync_manager.snapshot()
