from fastapi import APIRouter, HTTPException
from sqlmodel import col, select, update

from app.db import SessionDep
from app.engine import ai
from app.models import Txn

router = APIRouter(tags=["ai"])


@router.get("/ai/status")
def status(session: SessionDep) -> dict:
    return {
        "available": ai.credentials_available(),
        "model": ai.MODEL,
        "pending": len({t.merchant for t in ai.candidates(session)}),
    }


@router.post("/ai/suggest")
def suggest(session: SessionDep) -> dict:
    try:
        return ai.suggest(session)
    except ai.AIError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/ai/clear")
def clear(session: SessionDep) -> dict:
    """Forget suggestions (e.g. to ask again after adding categories)."""
    session.exec(update(Txn).where(col(Txn.ai_category).is_not(None)).values(ai_category=None, ai_reason=None))
    session.commit()
    n = len(session.exec(select(Txn.id).where(col(Txn.ai_category).is_not(None))).all())
    return {"remaining": n}
