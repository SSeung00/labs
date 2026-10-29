import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / "backend" / ".env")

DATA_DIR = Path(os.environ.get("ENGLISHLAB_DATA_DIR") or ROOT_DIR / "data")
DB_PATH = DATA_DIR / "englishlab.db"
AUDIO_DIR = DATA_DIR / "audio"  # recordings of the learner (conversation turns)
TTS_DIR = DATA_DIR / "tts"  # cached synthesized speech + word timings

FRONTEND_DIST = (ROOT_DIR / "frontend" / "dist").resolve()

PORT = int(os.environ.get("ENGLISHLAB_PORT") or 8005)
FRONTEND_ORIGINS = ["http://localhost:5178", "http://127.0.0.1:5178"]

# Speech-to-text model (faster-whisper). Tests set ENGLISHLAB_STT=off to skip loading it.
STT_MODEL = os.environ.get("ENGLISHLAB_STT_MODEL", "large-v3-turbo")
STT_ENABLED = os.environ.get("ENGLISHLAB_STT", "on") != "off"

for d in (DATA_DIR, AUDIO_DIR, TTS_DIR):
    d.mkdir(parents=True, exist_ok=True)
