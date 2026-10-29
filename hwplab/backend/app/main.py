from urllib.parse import quote

from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response

from app import store
from app.config import FRONTEND_DIST, FRONTEND_ORIGINS, MAX_UPLOAD_MB
from app.hwp.equation import to_latex

app = FastAPI(title="HwpLab API", version="0.1.0")
app.add_middleware(GZipMiddleware, minimum_size=2048)
app.add_middleware(CORSMiddleware, allow_origins=FRONTEND_ORIGINS, allow_methods=["*"], allow_headers=["*"])


def _guard(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except FileNotFoundError:
        raise HTTPException(404, "문서를 찾을 수 없어요.")
    except store.StoreError as e:
        raise HTTPException(400, str(e))


async def _read_upload(file: UploadFile) -> bytes:
    data = await file.read(MAX_UPLOAD_MB * 1024 * 1024 + 1)
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"{MAX_UPLOAD_MB}MB보다 큰 파일은 열 수 없어요.")
    return data


def _download_headers(filename: str) -> dict:
    ascii_name = filename.encode("ascii", "replace").decode().replace("?", "_")
    return {"Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"}


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/equation/latex")
def equation_latex(body: dict = Body(...)):
    return {"latex": to_latex(str(body.get("script", ""))[:4000])}


@app.get("/api/docs")
def list_docs():
    return store.list_docs()


@app.post("/api/docs")
async def import_doc(file: UploadFile = File(...)):
    data = await _read_upload(file)
    return _guard(store.import_file, file.filename or "문서.hwp", data)


@app.post("/api/docs/new")
def new_doc(body: dict = Body(default={})):
    return store.new_doc(body.get("title", ""))


@app.get("/api/docs/{doc_id}")
def get_doc(doc_id: str):
    return _guard(store.get_doc, doc_id)


@app.put("/api/docs/{doc_id}")
def save_doc(doc_id: str, body: dict = Body(...)):
    return _guard(store.save_doc, doc_id, body.get("doc"), body.get("title"), body.get("baseVersion"))


@app.patch("/api/docs/{doc_id}")
def rename_doc(doc_id: str, body: dict = Body(...)):
    return _guard(store.rename_doc, doc_id, str(body.get("title", "")))


@app.delete("/api/docs/{doc_id}")
def delete_doc(doc_id: str):
    _guard(store.delete_doc, doc_id)
    return {"ok": True}


@app.get("/api/docs/{doc_id}/bin/{name}")
def get_bin(doc_id: str, name: str):
    path = _guard(store.bin_path, doc_id, name)
    return FileResponse(path, headers={"Cache-Control": "private, max-age=86400"})


@app.post("/api/docs/{doc_id}/bin")
async def add_image(doc_id: str, file: UploadFile = File(...)):
    data = await _read_upload(file)
    return _guard(store.add_image, doc_id, file.filename or "image.png", data)


@app.get("/api/docs/{doc_id}/history")
def history(doc_id: str):
    return _guard(store.history, doc_id)


@app.get("/api/docs/{doc_id}/history/{name}")
def history_doc(doc_id: str, name: str):
    return _guard(store.history_doc, doc_id, name)


@app.get("/api/docs/{doc_id}/export.hwpx")
def export_hwpx(doc_id: str):
    title, data = _guard(store.export_hwpx, doc_id)
    return Response(data, media_type="application/hwp+zip", headers=_download_headers(f"{title}.hwpx"))


@app.get("/api/docs/{doc_id}/source")
def source(doc_id: str):
    path = _guard(store.source_file, doc_id)
    if path is None:
        raise HTTPException(404, "원본 파일이 없는 문서예요.")
    meta = _guard(store.get_doc, doc_id)["meta"]
    return FileResponse(path, headers=_download_headers(meta.get("sourceName") or path.name))


# ---------- built web app (frontend/dist) ----------

NO_CACHE = {"Cache-Control": "no-cache"}


@app.get("/{path:path}", include_in_schema=False)
def web_app(path: str) -> FileResponse:
    if path == "api" or path.startswith("api/"):
        raise HTTPException(404, "Not Found")
    index = FRONTEND_DIST / "index.html"
    if not index.exists():
        raise HTTPException(404, "웹 화면이 아직 빌드되지 않았어요. frontend에서 npm run build를 실행하세요.")
    file = (FRONTEND_DIST / path).resolve()
    if path and file.is_file() and file.is_relative_to(FRONTEND_DIST):
        immutable = path.startswith("assets/")
        headers = {"Cache-Control": "public, max-age=31536000, immutable"} if immutable else NO_CACHE
        return FileResponse(file, headers=headers)
    return FileResponse(index, headers=NO_CACHE)
