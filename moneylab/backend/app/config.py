import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("MONEYLAB_DATA_DIR") or ROOT_DIR / "data")
DB_PATH = DATA_DIR / "moneylab.db"

FRONTEND_DIST = (ROOT_DIR / "frontend" / "dist").resolve()

PORT = int(os.environ.get("MONEYLAB_PORT") or 8001)
FRONTEND_ORIGINS = ["http://localhost:5174", "http://127.0.0.1:5174"]

DATA_DIR.mkdir(parents=True, exist_ok=True)
