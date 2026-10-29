import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from sqlmodel import Session

from app.auth import RemoteAuthMiddleware
from app.config import FRONTEND_DIST, FRONTEND_ORIGINS
from app.db import engine, init_db
from app.engine.backup import start_scheduler as start_backup_scheduler
from app.engine.defaults import seed_defaults
from app.engine.migrate import run_startup_migrations
from app.routers import (
    ai,
    assistant,
    budget,
    claims,
    goals,
    hooks,
    imports,
    invest,
    remote,
    rules,
    summary,
    system,
    tools,
    transactions,
    trips,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    with Session(engine) as session:
        seed_defaults(session)
        run_startup_migrations(session)
    if not os.environ.get("MONEYLAB_NO_BACKUP"):
        start_backup_scheduler(engine)
    yield


app = FastAPI(title="MoneyLab API", version="0.1.0", lifespan=lifespan)

app.add_middleware(RemoteAuthMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

ROUTERS = (
    system, imports, transactions, summary, trips, rules, goals, budget, invest, hooks, ai, assistant,
    tools, claims, remote,
)
for module in ROUTERS:
    app.include_router(module.router, prefix="/api")


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
