"""Encrypted daily backups of the database.

The whole ledger lives in one SQLite file, so losing the PC (or the file) loses everything.
A consistent copy is taken with SQLite's online backup API, gzipped and encrypted with a key
that is kept *outside* the backup (in ~/.moneylab/backup.key) — so the backup folder can be a
cloud-synced folder without exposing the data. Keep the key somewhere safe (a password
manager); without it the backups can't be opened.

Restore with: uv run python -m app.tools.restore <file>
"""

from __future__ import annotations

import gzip
import os
import sqlite3
import tempfile
import threading
import time
from datetime import datetime
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from sqlmodel import Session

from app.config import DATA_DIR, DB_PATH
from app.engine.budget import get_setting, put_setting

KEY_FILE = Path(os.environ.get("MONEYLAB_BACKUP_KEY") or Path.home() / ".moneylab" / "backup.key")
DIR_KEY = "backup.dir"
LAST_KEY = "backup.last"
KEEP = 30
EVERY_HOURS = 24
SUFFIX = ".mlbak"


def backup_dir(session: Session) -> Path:
    return Path(get_setting(session, DIR_KEY) or DATA_DIR / "backups")


def load_key(create: bool = True) -> bytes:
    if KEY_FILE.exists():
        return KEY_FILE.read_bytes().strip()
    if not create:
        raise FileNotFoundError(str(KEY_FILE))
    KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    key = Fernet.generate_key()
    KEY_FILE.write_bytes(key)
    return key


def _snapshot_bytes(db_path: Path) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        dst = Path(tmp) / "copy.db"
        src = sqlite3.connect(db_path)
        out = sqlite3.connect(dst)
        try:
            src.backup(out)
        finally:
            out.close()
            src.close()
        return dst.read_bytes()


def encrypt(raw: bytes, key: bytes) -> bytes:
    return Fernet(key).encrypt(gzip.compress(raw, compresslevel=6))


def decrypt(blob: bytes, key: bytes) -> bytes:
    try:
        return gzip.decompress(Fernet(key).decrypt(blob))
    except InvalidToken as e:
        raise ValueError("복구 키가 맞지 않거나 파일이 손상됐어요.") from e


def create_backup(session: Session, db_path: Path = DB_PATH) -> dict:
    folder = backup_dir(session)
    folder.mkdir(parents=True, exist_ok=True)
    blob = encrypt(_snapshot_bytes(db_path), load_key())
    name = f"moneylab-{datetime.now():%Y%m%d-%H%M%S}{SUFFIX}"
    (folder / name).write_bytes(blob)
    for old in sorted(folder.glob(f"moneylab-*{SUFFIX}"))[:-KEEP]:
        old.unlink(missing_ok=True)
    put_setting(session, LAST_KEY, datetime.now().isoformat(timespec="seconds"))
    session.commit()
    return {"file": name, "bytes": len(blob)}


def status(session: Session) -> dict:
    folder = backup_dir(session)
    files = sorted(folder.glob(f"moneylab-*{SUFFIX}"), reverse=True) if folder.exists() else []
    return {
        "dir": str(folder),
        "default_dir": str(DATA_DIR / "backups"),
        "key_file": str(KEY_FILE),
        "key_exists": KEY_FILE.exists(),
        "last": get_setting(session, LAST_KEY),
        "keep": KEEP,
        "files": [{"name": f.name, "bytes": f.stat().st_size,
                   "at": datetime.fromtimestamp(f.stat().st_mtime).isoformat(timespec="seconds")} for f in files[:KEEP]],
    }


def due(session: Session) -> bool:
    last = get_setting(session, LAST_KEY)
    if not last:
        return True
    try:
        return (datetime.now() - datetime.fromisoformat(last)).total_seconds() > EVERY_HOURS * 3600
    except ValueError:
        return True


def start_scheduler(engine) -> threading.Thread:
    """Back up on start-up when due, then check hourly. Failures are retried next hour."""

    def loop():
        while True:
            try:
                with Session(engine) as s:
                    if due(s):
                        create_backup(s)
            except Exception as e:  # never take the server down over a backup
                print(f"[backup] failed: {e}")
            time.sleep(3600)

    t = threading.Thread(target=loop, daemon=True, name="backup")
    t.start()
    return t
