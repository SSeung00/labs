"""Health, PC service, profile, tutor memory, AI budget/models, voices and TTS audio."""

import threading

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app import auth, desktop
from app.core import claude_cli, llm, speech, store
from app.db import SessionDep
from app.learn import lexicon, srs

router = APIRouter(tags=["system"])


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "stt": speech.stt_status()}


# ---------- running as a PC program (background service, start at log-in) ----------

def _local_only(request: Request) -> None:
    if not auth.is_local(request.scope):
        raise HTTPException(403, "PC에서만 바꿀 수 있어요.")


@router.get("/system/service")
def service_status() -> dict:
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


@router.get("/profile")
def get_profile(session: SessionDep) -> dict:
    return {"profile": store.profile(session), "voices": speech.VOICES, "memory": store.memory(session),
            "vocab_estimate": lexicon.vocab_estimate(session),
            "retention": store.get(session, srs.RETENTION_KEY, srs.DEFAULT_RETENTION)}


class ProfileBody(BaseModel):
    changes: dict


@router.put("/profile")
def put_profile(body: ProfileBody, session: SessionDep) -> dict:
    ch = dict(body.changes)
    if "voice" in ch and ch["voice"] not in speech.VOICE_IDS:
        raise HTTPException(400, "지원하지 않는 목소리예요.")
    for k, lo, hi in (("daily_minutes", 10, 600), ("daily_goal_minutes", 5, 600), ("new_cards_per_day", 0, 200),
                      ("max_reviews_per_day", 10, 2000), ("tts_rate", -50, 50)):
        if k in ch:
            ch[k] = max(lo, min(hi, int(ch[k])))
    if "interests" in ch:
        ch["interests"] = [str(x).strip() for x in ch["interests"] if str(x).strip()][:20]
    return {"profile": store.update_profile(session, ch)}


class RetentionBody(BaseModel):
    retention: float = Field(ge=0.8, le=0.97)


@router.put("/srs/retention")
def put_retention(body: RetentionBody, session: SessionDep) -> dict:
    store.put(session, srs.RETENTION_KEY, body.retention)
    return {"retention": body.retention}


class MemoryBody(BaseModel):
    facts: list[str]


@router.put("/memory")
def put_memory(body: MemoryBody, session: SessionDep) -> dict:
    store.put(session, store.MEMORY_KEY, [f.strip() for f in body.facts if f.strip()][: store.MEMORY_LIMIT])
    return {"memory": store.memory(session)}


@router.get("/ai")
def ai_status(session: SessionDep) -> dict:
    return {"usage": llm.usage_summary(session), "config": llm.config_view(session)}


class BudgetBody(BaseModel):
    budget_usd: float = Field(ge=0, le=1000)


@router.put("/ai/budget")
def put_budget(body: BudgetBody, session: SessionDep) -> dict:
    llm.set_budget_usd(session, body.budget_usd)
    return llm.usage_summary(session)


class ProviderBody(BaseModel):
    provider: str = Field(pattern="^(auto|cli|api)$")


@router.put("/ai/provider")
def put_provider(body: ProviderBody, session: SessionDep) -> dict:
    llm.set_provider(session, body.provider)
    return llm.usage_summary(session)


@router.post("/ai/cli/recheck")
def recheck_cli() -> dict:
    return claude_cli.status(refresh=True)


class FeatureBody(BaseModel):
    model: str | None = None
    effort: str | None = None


@router.put("/ai/features/{feature}")
def put_feature(feature: str, body: FeatureBody, session: SessionDep) -> dict:
    llm.set_feature_config(session, feature, body.model, body.effort)
    return llm.config_view(session)


# ---------- text to speech ----------

class TtsBody(BaseModel):
    text: str = Field(min_length=1, max_length=6000)
    rate: int | None = None
    voice: str | None = None


@router.post("/tts")
def tts(body: TtsBody, session: SessionDep) -> dict:
    p = store.profile(session)
    rate = body.rate if body.rate is not None else int(p["tts_rate"])
    return speech.synthesize(body.text, body.voice or p["voice"], rate)


@router.get("/tts/{key}.mp3")
def tts_audio(key: str) -> FileResponse:
    if not key.isalnum():
        raise HTTPException(404)
    mp3, _ = speech.tts_paths(key)
    if not speech.wait_for(key, 30):
        raise HTTPException(404, "음성이 없어요.")
    return FileResponse(mp3, media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=31536000, immutable"})
