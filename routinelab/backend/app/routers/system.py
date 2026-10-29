"""Health, settings, stats, push subscriptions, PC-app integration and data export."""

import json
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlmodel import SQLModel, select

from app import auth, desktop
from app.core import push, store
from app.db import SessionDep
from app.models import PushSub, Sent, Setting
from app.routine import stats as stats_mod

router = APIRouter(tags=["system"])


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/settings")
def get_settings(session: SessionDep) -> dict:
    return store.settings(session)


class SettingsBody(BaseModel):
    changes: dict


@router.put("/settings")
def put_settings(body: SettingsBody, session: SessionDep) -> dict:
    return store.update_settings(session, body.changes)


@router.get("/stats")
def get_stats(session: SessionDep) -> dict:
    return stats_mod.stats(session)


# ---------- push notifications ----------

@router.get("/push/key")
def push_key(session: SessionDep) -> dict:
    subs = session.exec(select(PushSub)).all()
    return {"key": push.public_key(), "devices": [{"label": s.label, "endpoint": s.endpoint} for s in subs]}


class SubKeys(BaseModel):
    p256dh: str = Field(max_length=200)
    auth: str = Field(max_length=100)


class SubBody(BaseModel):
    endpoint: str = Field(max_length=1000)
    keys: SubKeys
    label: str = Field(default="", max_length=80)


@router.post("/push/subscribe")
def push_subscribe(body: SubBody, session: SessionDep) -> dict:
    if not body.endpoint.startswith("https://"):
        raise HTTPException(400, "알림 주소가 올바르지 않아요.")
    push.subscribe(session, body.endpoint, body.keys.p256dh, body.keys.auth, body.label)
    return push_key(session)


class UnsubBody(BaseModel):
    endpoint: str


@router.post("/push/unsubscribe")
def push_unsubscribe(body: UnsubBody, session: SessionDep) -> dict:
    push.unsubscribe(session, body.endpoint)
    return push_key(session)


@router.post("/push/test")
def push_test(session: SessionDep) -> dict:
    sent = push.send_all(session, {"title": "RoutineLab 알림 테스트 🔔", "body": "이렇게 알려 드릴게요.", "tag": "test", "url": "/"})
    return {"sent": sent}


# ---------- PC app (Windows) ----------

@router.get("/desktop")
def desktop_status() -> dict:
    return desktop.status()


class AutostartBody(BaseModel):
    enabled: bool


@router.put("/desktop/autostart")
def put_autostart(body: AutostartBody, request: Request) -> dict:
    if not auth.is_local(request.scope):
        raise HTTPException(403, "PC에서만 바꿀 수 있어요.")
    desktop.set_autostart(body.enabled)
    if body.enabled:
        desktop.make_app_shortcuts()
    return desktop.status()


# ---------- export ----------

SKIP_TABLES = {Setting.__tablename__, PushSub.__tablename__, Sent.__tablename__}


@router.get("/export")
def export(session: SessionDep) -> Response:
    """Everything except secrets (PIN, push keys) as one JSON file."""
    out: dict = {"app": "RoutineLab", "exported_at": datetime.now().isoformat(timespec="seconds"),
                 "settings": store.settings(session)}
    for table in SQLModel.metadata.sorted_tables:
        if table.name in SKIP_TABLES:
            continue
        rows = session.connection().execute(table.select()).mappings().all()
        out[table.name] = [{k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in r.items()} for r in rows]
    body = json.dumps(out, ensure_ascii=False, indent=1)
    name = f"routinelab-{datetime.now():%Y%m%d}.json"
    return Response(body, media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{name}"'})
