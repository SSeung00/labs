import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("RUNLAB_DATA_DIR") or ROOT_DIR / "data")
STREAMS_DIR = DATA_DIR / "streams"
DB_PATH = DATA_DIR / "runlab.db"

# Garmin session tokens live outside the repo; the password is never stored.
TOKEN_DIR = Path(os.environ.get("RUNLAB_TOKEN_DIR") or Path.home() / ".runlab" / "garmin")

FRONTEND_DIST = (ROOT_DIR / "frontend" / "dist").resolve()

FRONTEND_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

for d in (DATA_DIR, STREAMS_DIR):
    d.mkdir(parents=True, exist_ok=True)
