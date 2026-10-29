import json
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Form, HTTPException, UploadFile
from sqlmodel import col, select

from app.db import SessionDep
from app.ingest import file_import
from app.ingest.banksalad import ExportFormatError
from app.ingest.service import import_banksalad
from app.models import ImportBatch, ImportTemplate

router = APIRouter(tags=["imports"])

MAX_BYTES = 20 * 1024 * 1024


async def _read(f: UploadFile) -> bytes:
    data = await f.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(400, "파일이 너무 커요 (20MB 초과).")
    return data


@router.post("/imports")
async def upload(files: list[UploadFile], session: SessionDep) -> dict:
    # Oldest export first, so occurrence numbering and balance snapshots settle in order.
    files = sorted(files, key=lambda f: f.filename or "")
    results = []
    for f in files:
        name = f.filename or "export.xlsx"
        try:
            data = await _read(f)
            results.append(import_banksalad(session, data, name))
        except HTTPException as e:
            results.append({"filename": name, "error": e.detail})
        except ExportFormatError as e:
            session.rollback()
            results.append({"filename": name, "error": str(e), "not_banksalad": True})
    if results and all("error" in r for r in results):
        first = results[0]
        if first.get("not_banksalad"):
            # Let the client offer the column-mapping importer instead.
            raise HTTPException(422, {"message": first["error"], "code": "not_banksalad"})
        raise HTTPException(400, first["error"])
    return {"results": results}


@router.get("/imports")
def history(session: SessionDep) -> list[ImportBatch]:
    return list(session.exec(select(ImportBatch).order_by(col(ImportBatch.id).desc()).limit(50)).all())


# ---------- other bank / card files ----------

@router.post("/imports/file/preview")
async def file_preview(file: UploadFile, session: SessionDep) -> dict:
    data = await _read(file)
    try:
        return file_import.preview(session, data, file.filename or "file")
    except ExportFormatError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/imports/file/commit")
async def file_commit(
    session: SessionDep,
    file: UploadFile,
    mapping: Annotated[str, Form()],
    account_id: Annotated[int | None, Form()] = None,
    new_account: Annotated[str | None, Form()] = None,
    cutoff: Annotated[date | None, Form()] = None,
    save_template: Annotated[str | None, Form()] = None,
) -> dict:
    data = await _read(file)
    try:
        m = json.loads(mapping)
        acc = json.loads(new_account) if new_account else None
    except json.JSONDecodeError as e:
        raise HTTPException(400, "요청 형식이 올바르지 않아요.") from e
    if m.get("date") is None or (m.get("amount") is None and m.get("out") is None and m.get("in") is None):
        raise HTTPException(400, "날짜와 금액 열은 꼭 골라 주세요.")
    try:
        return file_import.commit(
            session, data, file.filename or "file", m, account_id, acc, cutoff, save_template or None,
        )
    except ExportFormatError as e:
        session.rollback()
        raise HTTPException(400, str(e)) from e


@router.get("/imports/templates")
def templates(session: SessionDep) -> list[ImportTemplate]:
    return list(session.exec(select(ImportTemplate)).all())


@router.delete("/imports/templates/{tpl_id}")
def delete_template(tpl_id: int, session: SessionDep) -> dict:
    t = session.get(ImportTemplate, tpl_id)
    if t:
        session.delete(t)
        session.commit()
    return {"ok": True}
