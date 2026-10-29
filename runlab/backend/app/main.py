import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from sqlmodel import Session

from app.analytics.journal import seed_defaults
from app.analytics.metrics import fill_lap_speeds, needs_recompute
from app.auth import RemoteAuthMiddleware
from app.config import FRONTEND_DIST, FRONTEND_ORIGINS
from app.db import engine, init_db
from app.ingest.auto_sync import start_scheduler
from app.ingest.garmin_sync import resume_interrupted, sync_manager
from app.routers import (
    activities,
    analytics,
    coach,
    export,
    garmin,
    gear,
    insights,
    journal,
    planner,
    progress,
    remote,
    system,
    wellness,
)


def _startup_jobs() -> None:
    with Session(engine) as session:
        seed_defaults(session)
        fill_lap_speeds(session)
        if resume_interrupted(session):
            return
        if needs_recompute(session):
            sync_manager.start_recompute()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    # Garmin session restore can hit the network; keep startup non-blocking.
    threading.Thread(target=_startup_jobs, daemon=True, name="startup").start()
    start_scheduler()  # daily Garmin sync (background service only)
    yield


app = FastAPI(title="RunLab API", version="0.1.0", lifespan=lifespan)

app.add_middleware(RemoteAuthMiddleware)
# Phones on mobile data: the JS bundle and JSON shrink ~70%.
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

ROUTERS = (
    system, garmin, activities, wellness, analytics, journal,
    progress, planner, gear, insights, coach, export, remote,
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
        # Hashed bundles never change; everything else (sw.js, manifest, icons) revalidates.
        immutable = path.startswith("assets/")
        headers = {"Cache-Control": "public, max-age=31536000, immutable"} if immutable else NO_CACHE
        return FileResponse(file, headers=headers)
    if path.startswith("assets/"):
        # A missing bundle must fail loudly, not come back as HTML (that broke the map worker).
        raise HTTPException(404, "Not Found")
    return FileResponse(index, headers=NO_CACHE)  # SPA route
