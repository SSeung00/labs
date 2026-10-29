from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlmodel import Session

from app.auth import RemoteAuthMiddleware
from app.config import FRONTEND_DIST, FRONTEND_ORIGINS, SCHEDULER_ENABLED
from app.core import scheduler
from app.db import engine, init_db
from app.routers import day, habits, modes, remote, system
from app.routine.service import ensure_defaults


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    with Session(engine) as session:
        ensure_defaults(session)
    if SCHEDULER_ENABLED:
        scheduler.start()
    yield
    scheduler.stop()


app = FastAPI(title="RoutineLab API", version="0.1.0", lifespan=lifespan)

app.add_middleware(RemoteAuthMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(CORSMiddleware, allow_origins=FRONTEND_ORIGINS, allow_methods=["*"], allow_headers=["*"])

for module in (system, remote, habits, day, modes):
    app.include_router(module.router, prefix="/api")


# Expected failures (bad input) become readable 400s instead of 500s.
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
