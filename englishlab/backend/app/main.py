from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse

from app.auth import RemoteAuthMiddleware
from app.config import FRONTEND_DIST, FRONTEND_ORIGINS
from app.core import speech
from app.core.llm import AIError
from app.db import init_db
from app.learn.reading import ReadingError
from app.routers import notes, placement, plan, progress, reading, remote, system, talk, words


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    speech.preload_async()  # Whisper takes a few seconds to load; do it before the first conversation
    yield


app = FastAPI(title="EnglishLab API", version="0.1.0", lifespan=lifespan)

app.add_middleware(RemoteAuthMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(CORSMiddleware, allow_origins=FRONTEND_ORIGINS, allow_methods=["*"], allow_headers=["*"])

for module in (system, remote, placement, reading, words, talk, progress, plan, notes):
    app.include_router(module.router, prefix="/api")


# Expected failures (AI, speech, bad input) become readable 400s instead of 500s.
@app.exception_handler(AIError)
@app.exception_handler(speech.SpeechError)
@app.exception_handler(ReadingError)
@app.exception_handler(ValueError)
async def _user_error(_request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=400)


# ---------- built web app (frontend/dist), so one port serves PC and phone ----------

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
    return FileResponse(index, headers=NO_CACHE)  # SPA route
