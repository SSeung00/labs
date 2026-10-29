from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import col, select

from app.coach import activity as activity_ai
from app.coach import chat as chat_ai
from app.coach import journal_ai, plan_ai
from app.coach.llm import (
    MODEL,
    CoachError,
    config_view,
    credentials_available,
    set_budget_usd,
    set_feature_config,
    usage_summary,
)
from app.coach.report import build_context, generate_weekly
from app.db import SessionDep
from app.models import CoachChat, CoachReport

router = APIRouter(tags=["coach"])


def _wrap(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except CoachError as e:
        raise HTTPException(400, str(e)) from e


@router.get("/coach/status")
def status() -> dict:
    return {"available": credentials_available(), "model": MODEL}


@router.get("/coach/usage")
def usage(session: SessionDep) -> dict:
    return usage_summary(session)


class BudgetBody(BaseModel):
    usd: float = Field(ge=0, le=1000)


@router.put("/coach/budget")
def put_budget(body: BudgetBody, session: SessionDep) -> dict:
    set_budget_usd(session, body.usd)
    return usage_summary(session)


class ConfigBody(BaseModel):
    feature: str
    model: str
    effort: str


@router.get("/coach/config")
def get_config(session: SessionDep) -> dict:
    return config_view(session)


@router.put("/coach/config")
def put_config(body: ConfigBody, session: SessionDep) -> dict:
    _wrap(set_feature_config, session, body.feature, body.model, body.effort)
    return config_view(session)


# ---------- weekly report ----------

@router.get("/coach/reports")
def reports(session: SessionDep, limit: int = 10) -> list[CoachReport]:
    return list(session.exec(select(CoachReport).order_by(col(CoachReport.created_at).desc()).limit(limit)))


@router.get("/coach/context")
def context(session: SessionDep) -> dict:
    """Exactly what would be sent to Claude — shown in the UI for transparency."""
    return build_context(session)


@router.post("/coach/weekly")
def weekly(session: SessionDep) -> CoachReport:
    return _wrap(generate_weekly, session)


# ---------- single run ----------

@router.get("/coach/activity/{activity_id}")
def activity_insight(activity_id: int, session: SessionDep) -> dict | None:
    row = activity_ai.latest(session, activity_id)
    return row.model_dump() if row else None


@router.get("/coach/activity/{activity_id}/context")
def activity_context(activity_id: int, session: SessionDep) -> dict:
    from app.models import Activity

    act = session.get(Activity, activity_id)
    if not act:
        raise HTTPException(404, "활동을 찾을 수 없어요.")
    return activity_ai.build_context(session, act)


@router.post("/coach/activity/{activity_id}")
def analyze_activity(activity_id: int, session: SessionDep) -> dict:
    return _wrap(activity_ai.analyze, session, activity_id).model_dump()


# ---------- journal ----------

class JournalParseBody(BaseModel):
    text: str
    injury_parts: list[str] = []


@router.post("/coach/journal/parse")
def journal_parse(body: JournalParseBody, session: SessionDep) -> dict:
    return _wrap(journal_ai.parse, session, body.text, body.injury_parts)


# ---------- plan ----------

class PlanProposeBody(BaseModel):
    text: str


@router.post("/coach/plan/propose")
def plan_propose(body: PlanProposeBody, session: SessionDep) -> dict:
    return _wrap(plan_ai.propose, session, body.text)


class PlanApplyBody(BaseModel):
    changes: list[dict]


@router.post("/coach/plan/apply")
def plan_apply(body: PlanApplyBody, session: SessionDep) -> dict:
    return {"applied": _wrap(plan_ai.apply, session, body.changes)}


# ---------- chat ----------

@router.get("/coach/chats")
def list_chats(session: SessionDep) -> list[dict]:
    rows = session.exec(select(CoachChat).order_by(col(CoachChat.updated_at).desc()).limit(50)).all()
    return [{"id": c.id, "title": c.title, "updated_at": c.updated_at, "cost_usd": c.cost_usd, "model": c.model} for c in rows]


@router.get("/coach/chats/{chat_id}")
def get_chat(chat_id: int, session: SessionDep) -> dict:
    c = session.get(CoachChat, chat_id)
    if not c:
        raise HTTPException(404, "대화를 찾을 수 없어요.")
    return chat_ai.display(c)


class ChatBody(BaseModel):
    chat_id: int | None = None
    text: str


@router.post("/coach/chats")
def send_chat(body: ChatBody, session: SessionDep) -> dict:
    return chat_ai.display(_wrap(chat_ai.send, session, body.chat_id, body.text))


@router.delete("/coach/chats/{chat_id}")
def delete_chat(chat_id: int, session: SessionDep) -> dict:
    c = session.get(CoachChat, chat_id)
    if c:
        session.delete(c)
        session.commit()
    return {"ok": True}
