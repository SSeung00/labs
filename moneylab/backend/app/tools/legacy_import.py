"""Annotate MoneyLab rows from an old hand-kept ledger CSV (see app.ingest.legacy).

    uv run python -m app.tools.legacy_import Transactions.csv                 # dry run
    uv run python -m app.tools.legacy_import Transactions.csv --apply \\
        --event "2026 Conference=3" --event "2026 Trip=4"

--event maps an event name in the CSV to a trip/event id (create those in 여행 first).
"""

import argparse
import sys
from pathlib import Path

from sqlmodel import Session

from app.db import engine, init_db
from app.ingest import legacy


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser()
    p.add_argument("csv", type=Path)
    p.add_argument("--apply", action="store_true")
    p.add_argument("--event", action="append", default=[], help='"이벤트 이름=여행 id"')
    a = p.parse_args()
    events = {}
    for e in a.event:
        name, _, tid = e.rpartition("=")
        events[name] = int(tid)
    init_db()
    with Session(engine) as s:
        r = legacy.apply(s, a.csv.read_bytes(), events, dry_run=not a.apply)
    print(f"{'적용' if a.apply else '미리보기'}: {r.rows}행 중 {r.matched}행 연결, 메모 {r.notes}, "
          f"종류 {r.kinds}, 카테고리 {r.categories}, 지원금 {r.vouchers}, 이벤트 {r.events}")
    for u in r.unmatched:
        print("  못 찾음:", u)


if __name__ == "__main__":
    main()
