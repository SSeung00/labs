"""Writing practice (typed or handwritten) and pen ink: annotations on readings, handwritten note pages."""

from datetime import datetime

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlmodel import select

from app.db import SessionDep
from app.learn import writing
from app.models import Book, Ink, Reading, Writing

router = APIRouter(tags=["notes"])

MAX_IMAGE = 8 * 1024 * 1024


# ---------- writing ----------

@router.get("/writing/tasks")
def writing_tasks() -> list[dict]:
    return writing.tasks()


class PromptBody(BaseModel):
    task: str


@router.post("/writing/prompt")
def writing_prompt(body: PromptBody, session: SessionDep) -> dict:
    return writing.make_prompt(session, body.task)


@router.post("/writing")
async def submit_writing(session: SessionDep, task: str = Form(...), prompt: str = Form(""), text: str = Form(""),
                         minutes: float = Form(0), image: UploadFile | None = File(None)) -> dict:
    data = await image.read() if image else None
    if data and len(data) > MAX_IMAGE:
        raise HTTPException(400, "손글씨 이미지가 너무 커요.")
    if data and not data.startswith(b"\x89PNG"):
        raise HTTPException(400, "손글씨는 PNG로 보내 주세요.")
    w = writing.submit(session, task=task, prompt=prompt, text=text, image=data or None,
                       minutes=max(0.0, min(minutes, 240.0)))
    return writing.view(w)


@router.get("/writing")
def writing_history(session: SessionDep) -> list[dict]:
    return writing.history(session)


@router.get("/writing/{wid}")
def get_writing(wid: int, session: SessionDep) -> dict:
    w = session.get(Writing, wid)
    if not w:
        raise HTTPException(404, "기록을 찾을 수 없어요.")
    return writing.view(w)


# ---------- ink ----------

SCOPES = ("reading", "readnote", "book", "note", "writing")


class InkBody(BaseModel):
    strokes: list = []
    highlights: list = []
    height: float = Field(default=0, ge=0, le=200000)
    title: str | None = Field(default=None, max_length=120)


def _ink_view(session, ink: Ink, strokes: bool = True) -> dict:
    title = ink.title
    if not title and ink.scope in ("reading", "readnote") and ink.ref_id:
        r = session.get(Reading, ink.ref_id)
        title = (r.title + (" · 메모" if ink.scope == "readnote" else "")) if r else None
    if not title and ink.scope == "book" and ink.ref_id:
        b = session.get(Book, ink.ref_id)
        title = b.title if b else None
    out = {"id": ink.id, "scope": ink.scope, "ref_id": ink.ref_id, "title": title or "메모",
           "updated_at": ink.updated_at.isoformat(timespec="minutes"), "height": ink.height,
           "stroke_count": len(ink.strokes or []), "highlight_count": len(ink.highlights or [])}
    if strokes:
        out |= {"strokes": ink.strokes, "highlights": ink.highlights}
    return out


def _find(session, scope: str, ref_id: int | None) -> Ink | None:
    q = select(Ink).where(Ink.scope == scope)
    q = q.where(Ink.ref_id == ref_id) if ref_id is not None else q.where(Ink.ref_id.is_(None))  # type: ignore[union-attr]
    return session.exec(q.order_by(Ink.id)).first()


@router.get("/ink/{scope}/{ref_id}")
def get_ink(scope: str, ref_id: int, session: SessionDep) -> dict:
    if scope not in SCOPES:
        raise HTTPException(404)
    ink = _find(session, scope, ref_id)
    if not ink:
        return {"id": None, "scope": scope, "ref_id": ref_id, "strokes": [], "highlights": [], "height": 0,
                "title": None}
    return _ink_view(session, ink)


@router.put("/ink/{scope}/{ref_id}")
def put_ink(scope: str, ref_id: int, body: InkBody, session: SessionDep) -> dict:
    if scope not in SCOPES:
        raise HTTPException(404)
    now = datetime.now()
    ink = _find(session, scope, ref_id) or Ink(created_at=now, updated_at=now, scope=scope, ref_id=ref_id)
    ink.strokes, ink.highlights, ink.height = body.strokes, body.highlights, body.height
    if body.title:
        ink.title = body.title
    ink.updated_at = now
    session.add(ink)
    session.commit()
    session.refresh(ink)
    return _ink_view(session, ink, strokes=False)


@router.get("/notes")
def list_notes(session: SessionDep) -> list[dict]:
    """Every page with pen marks (note pages, book notes, reading annotations), newest first."""
    rows = session.exec(select(Ink).order_by(Ink.updated_at.desc())).all()
    return [_ink_view(session, i, strokes=i.scope != "reading") for i in rows
            if i.scope == "note" or i.strokes or i.highlights]


class NewNote(BaseModel):
    title: str | None = Field(default=None, max_length=120)


@router.post("/notes")
def new_note(body: NewNote, session: SessionDep) -> dict:
    now = datetime.now()
    ink = Ink(created_at=now, updated_at=now, scope="note", title=(body.title or "").strip() or None, height=1400)
    session.add(ink)
    session.commit()
    session.refresh(ink)
    return _ink_view(session, ink)


def _note(session, nid: int) -> Ink:
    ink = session.get(Ink, nid)
    if not ink:
        raise HTTPException(404, "노트를 찾을 수 없어요.")
    return ink


@router.get("/notes/{nid}")
def get_note(nid: int, session: SessionDep) -> dict:
    return _ink_view(session, _note(session, nid))


@router.put("/notes/{nid}")
def put_note(nid: int, body: InkBody, session: SessionDep) -> dict:
    ink = _note(session, nid)
    ink.strokes, ink.highlights, ink.height = body.strokes, body.highlights, body.height
    if body.title is not None:
        ink.title = body.title.strip() or None
    ink.updated_at = datetime.now()
    session.add(ink)
    session.commit()
    return _ink_view(session, ink, strokes=False)


@router.delete("/notes/{nid}")
def delete_note(nid: int, session: SessionDep) -> dict:
    session.delete(_note(session, nid))
    session.commit()
    return {"ok": True}
