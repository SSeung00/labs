import os
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]

DATA_DIR = Path(os.environ.get("HWPLAB_DATA_DIR") or ROOT_DIR / "data")
DOCS_DIR = DATA_DIR / "docs"
TRASH_DIR = DATA_DIR / "trash"
FRONTEND_DIST = (ROOT_DIR / "frontend" / "dist").resolve()

PORT = int(os.environ.get("HWPLAB_PORT") or 8004)
FRONTEND_ORIGINS = ["http://localhost:5177", "http://127.0.0.1:5177"]

MAX_UPLOAD_MB = 200
HISTORY_KEEP = 20  # saved versions kept per document

for d in (DATA_DIR, DOCS_DIR, TRASH_DIR):
    d.mkdir(parents=True, exist_ok=True)
