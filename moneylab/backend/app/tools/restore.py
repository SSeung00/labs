"""Restore an encrypted MoneyLab backup.

Stop MoneyLab first, then from backend/:

    uv run python -m app.tools.restore <backup.mlbak> [--key <key or key file>] [--to <db path>]

The current database is kept next to it as moneylab.db.before-restore.
"""

import argparse
import shutil
import sys
from pathlib import Path

from app.config import DB_PATH
from app.engine.backup import KEY_FILE, decrypt


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Restore a MoneyLab backup")
    ap.add_argument("backup", type=Path)
    ap.add_argument("--key", help=f"recovery key, or a file containing it (default: {KEY_FILE})")
    ap.add_argument("--to", type=Path, default=DB_PATH)
    args = ap.parse_args(argv)

    if args.key:
        key = Path(args.key).read_bytes().strip() if Path(args.key).exists() else args.key.encode()
    else:
        key = KEY_FILE.read_bytes().strip()
    raw = decrypt(args.backup.read_bytes(), key)
    if args.to.exists():
        shutil.copy2(args.to, args.to.with_suffix(".db.before-restore"))
        for side in (args.to.with_suffix(".db-wal"), args.to.with_suffix(".db-shm")):
            side.unlink(missing_ok=True)
    args.to.write_bytes(raw)
    print(f"복원했어요: {args.backup.name} → {args.to}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
