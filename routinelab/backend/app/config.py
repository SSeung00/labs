import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / "backend" / ".env")

DATA_DIR = Path(os.environ.get("ROUTINELAB_DATA_DIR") or ROOT_DIR / "data")
DB_PATH = DATA_DIR / "routinelab.db"
BACKUP_DIR = DATA_DIR / "backups"  # daily copies of the database
VAPID_KEY = DATA_DIR / "vapid_private.pem"  # web-push signing key, made on first start

FRONTEND_DIST = (ROOT_DIR / "frontend" / "dist").resolve()

PORT = int(os.environ.get("ROUTINELAB_PORT") or 8006)
FRONTEND_ORIGINS = ["http://localhost:5179", "http://127.0.0.1:5179"]

# Reminder loop (push notifications, daily backup). Tests set ROUTINELAB_SCHEDULER=off.
SCHEDULER_ENABLED = os.environ.get("ROUTINELAB_SCHEDULER", "on") != "off"

for d in (DATA_DIR, BACKUP_DIR):
    d.mkdir(parents=True, exist_ok=True)
