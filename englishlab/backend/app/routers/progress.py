"""오늘 (daily plan), attendance, achievements, records and the AI coach's daily note."""

from datetime import date, timedelta

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlmodel import select

from app.core import llm, store
from app.db import SessionDep
from app.learn import levels, lexicon, mistakes, progress, srs
from app.models import Activity, Conversation, Placement

router = APIRouter(tags=["progress"])


@router.get("/today")
def today(session: SessionDep) -> dict:
    out = progress.today(session)
    out["levels"] = levels.current(session)
    out["known_words"] = lexicon.known_count(session)
    out["input_hours"] = progress.input_hours(session)
    out["new_badges"] = [b for b in progress.update_achievements(session) if b["new"]]
    return out


@router.post("/badges/seen")
def badges_seen(session: SessionDep) -> dict:
    progress.mark_seen(session)
    return {"ok": True}


class ActivityBody(BaseModel):
    kind: str = Field(pattern="^(external|listen|read|write|talk)$")
    minutes: float = Field(gt=0, le=600)
    note: str | None = Field(default=None, max_length=200)


@router.post("/activity")
def log(body: ActivityBody, session: SessionDep) -> dict:
    """Manual log, e.g. 넷플릭스 40분 (영어 자막)."""
    progress.log_activity(session, body.kind, body.minutes, note=body.note)
    return progress.today(session)


@router.get("/activity")
def recent(session: SessionDep, days: int = 14) -> list[dict]:
    since = date.today() - timedelta(days=days)
    rows = session.exec(select(Activity).where(Activity.day >= since).order_by(Activity.id.desc())).all()
    return [{"id": a.id, "day": a.day.isoformat(), "kind": a.kind, "minutes": a.minutes, "note": a.note,
             "at": a.created_at.isoformat(timespec="minutes")} for a in rows]


@router.delete("/activity/{aid}")
def delete_activity(aid: int, session: SessionDep) -> dict:
    a = session.get(Activity, aid)
    if a and a.kind in ("external",):
        session.delete(a)
        session.commit()
    return {"ok": True}


@router.get("/stats")
def stats(session: SessionDep) -> dict:
    progress.reconcile(session)
    p = store.profile(session)
    cur = levels.current(session)
    talks = session.exec(select(Conversation).where(Conversation.ended_at.is_not(None))  # type: ignore[union-attr]
                         .order_by(Conversation.id)).all()
    speaking_trend = [{"at": c.created_at.date().isoformat(), "wpm": (c.metrics or {}).get("wpm"),
                       "errors_per_100w": (c.metrics or {}).get("errors_per_100w"),
                       "lexical_diversity": (c.metrics or {}).get("lexical_diversity"),
                       "level": (c.report or {}).get("level")} for c in talks[-40:]]
    hours = progress.input_hours(session)
    known = lexicon.known_count(session)
    last_placement = session.exec(select(Placement).where(Placement.finished_at.is_not(None))  # type: ignore[union-attr]
                                  .order_by(Placement.id.desc())).first()
    return {
        "levels": cur,
        "level_history": levels.history(session),
        "streak": progress.streak(session),
        "calendar": progress.calendar(session, 126),
        "minutes_by_kind": progress.minutes_by_kind(session),
        "minutes_by_kind_7d": progress.minutes_by_kind(session, since=date.today() - timedelta(days=6)),
        "input_hours": hours,
        "input_goal_hours": 1000,
        "known_words": known,
        "vocab_goal": lexicon.vocab_for_level(6.0),
        "cards": srs.counts(session),
        "retention": srs.retention_stats(session),
        "speaking_trend": speaking_trend,
        "mistakes": [mistakes.view(m) for m in mistakes.top(session, 8)],
        "badges": progress.update_achievements(session),
        "target_date": p["target_date"],
        "last_placement": last_placement.finished_at.isoformat(timespec="minutes") if last_placement else None,
        "ai": llm.usage_summary(session),
    }


COACH_SCHEMA = llm.obj({"text": llm.STR})


@router.post("/today/coach")
def coach(session: SessionDep) -> dict:
    """One short Korean note for today (Haiku), cached for the day."""
    day = date.today().isoformat()
    tip = store.get(session, "coach_tip") or {}
    if tip.get("day") == day:
        return tip
    t = progress.today(session)
    facts = {
        "levels": levels.current(session)["labels"],
        "streak": t["streak"], "today_minutes": t["minutes"], "goal": t["goal_minutes"],
        "cards_due": t["cards"]["due"], "known_words": lexicon.known_count(session),
        "input_hours": progress.input_hours(session),
        "top_mistakes": [m.pattern for m in mistakes.top(session, 3)],
        "last_7_days_minutes": progress.minutes_by_kind(session, since=date.today() - timedelta(days=6)),
        "target": store.profile(session)["goal"], "target_date": store.profile(session)["target_date"],
    }
    out = llm.call_json(session, "coach", COACH_SCHEMA, max_tokens=1500, messages=[{"role": "user", "content": llm.as_json_block(
        "You are the learner's English coach. From these stats, write ONE short Korean message (2 sentences, max "
        "120 characters) for today: specific (mention a number or a weak point), warm, no generic cheerleading, "
        "suggest the single most useful thing to do today.", facts)}])
    tip = {"day": day, "text": out["text"]}
    store.put(session, "coach_tip", tip)
    return tip
