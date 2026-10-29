"""Import a bank/card statement file with a confirmed column mapping (see ingest.generic)."""

import hashlib
import json
from collections import Counter
from datetime import date, datetime

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.engine.ledger import keep, ledger_start
from app.engine.pipeline import reprocess
from app.ingest import generic as G
from app.ingest.service import ensure_account
from app.models import Account, ImportBatch, ImportTemplate, Txn


def file_key(account: str, row) -> str:
    raw = "|".join(["file", account, row.occurred_at.isoformat(), str(row.amount), row.merchant])
    return hashlib.sha1(raw.encode()).hexdigest()


def default_cutoff(session: Session, account_id: int | None) -> date | None:
    """First day Banksalad has for this account: older rows are what the file should fill in."""
    if not account_id:
        return None
    first = session.exec(
        select(func.min(Txn.occurred_at)).where(Txn.account_id == account_id, Txn.source != "file")
    ).one()
    return first.date() if first else None


def preview(session: Session, data: bytes, filename: str) -> dict:
    table = G.read_table(data, filename)
    hidx = G.find_header(table)
    header = [G._t(c) for c in table[hidx]]
    sig = G.signature(table[hidx])
    tpl = session.exec(select(ImportTemplate).where(ImportTemplate.signature == sig)).first()
    mapping = json.loads(tpl.mapping) if tpl else G.guess_mapping(table[hidx])
    account_id = tpl.account_id if tpl else None
    acc = session.get(Account, account_id) if account_id else None
    parsed = G.parse_rows(table, hidx, mapping, acc.name if acc else "?", acc.kind if acc else "bank")
    return {
        "filename": filename,
        "header_row": hidx,
        "header": header,
        "sample": G.preview_rows(table, hidx),
        "mapping": mapping,
        "template": {"id": tpl.id, "name": tpl.name} if tpl else None,
        "account_id": account_id,
        "cutoff": default_cutoff(session, account_id),
        "rows": len(parsed.rows),
        "skipped": parsed.skipped,
        "first": parsed.first,
        "last": parsed.last,
        "parsed_sample": [
            {"occurred_at": r.occurred_at, "merchant": r.merchant, "amount": r.amount, "memo": r.memo}
            for r in parsed.rows[:8]
        ],
    }


def commit(session: Session, data: bytes, filename: str, mapping: dict, account_id: int | None,
           new_account: dict | None, cutoff: date | None, save_template: str | None) -> dict:
    table = G.read_table(data, filename)
    hidx = G.find_header(table)
    if account_id:
        acc = session.get(Account, account_id)
        if not acc:
            raise G.ExportFormatError("계좌를 찾을 수 없어요.")
    elif new_account and new_account.get("name"):
        acc, _ = ensure_account(session, new_account["name"].strip(), new_account.get("kind") or None)
    else:
        raise G.ExportFormatError("어느 계좌·카드의 내역인지 골라 주세요.")

    parsed = G.parse_rows(table, hidx, mapping, acc.name, acc.kind)
    start = ledger_start(session)
    rows = [r for r in parsed.rows if (not cutoff or r.occurred_at.date() < cutoff) and keep(start, r.occurred_at)]
    after_cutoff = len(parsed.rows) - len(rows)

    batch = ImportBatch(
        source="file", filename=filename, sha256=hashlib.sha256(data).hexdigest(),
        imported_at=datetime.now(), period_start=parsed.first, period_end=parsed.last,
        rows_total=len(parsed.rows), rows_skipped=parsed.skipped + after_cutoff,
    )
    session.add(batch)
    session.flush()

    keys = [file_key(acc.name, r) for r in rows]
    seen: Counter[str] = Counter()
    existing = set(
        session.exec(select(Txn.base_key, Txn.occurrence).where(col(Txn.base_key).in_(set(keys)))).all()
    )
    new = 0
    for r, k in zip(rows, keys):
        seen[k] += 1
        if (k, seen[k]) in existing:
            continue
        session.add(Txn(
            account_id=acc.id, occurred_at=r.occurred_at, amount=r.amount, merchant=r.merchant,
            src_type=r.src_type, src_memo=r.memo, base_key=k, occurrence=seen[k],
            batch_id=batch.id, source="file",
        ))
        new += 1
    batch.rows_new = new
    batch.rows_existing = len(rows) - new
    session.add(batch)

    if save_template:
        sig = G.signature(table[hidx])
        tpl = session.exec(select(ImportTemplate).where(ImportTemplate.signature == sig)).first()
        tpl = tpl or ImportTemplate(signature=sig, name=save_template, mapping="{}")
        tpl.name = save_template
        tpl.mapping = json.dumps(mapping, ensure_ascii=False)
        tpl.account_id = acc.id
        session.add(tpl)
    session.commit()
    reprocess(session)
    return {
        "filename": filename,
        "batch_id": batch.id,
        "account": acc.label or acc.name,
        "period_start": parsed.first,
        "period_end": parsed.last,
        "rows_total": len(parsed.rows),
        "rows_new": new,
        "rows_existing": len(rows) - new,
        "rows_skipped": parsed.skipped,
        "after_cutoff": after_cutoff,
    }
