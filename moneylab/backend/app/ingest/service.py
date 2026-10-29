import hashlib
from datetime import date, datetime

from sqlalchemy import func
from sqlmodel import Session, delete, select

from app.engine.classify import infer_account_kind, infer_issuer
from app.engine.ledger import keep, ledger_start
from app.engine.pipeline import reprocess
from app.ingest.banksalad import Investment, parse_export, row_keys
from app.models import Account, BalanceSnapshot, Holding, HoldingSnapshot, ImportBatch, Txn

# Banksalad 투자상품종류 → our asset classes (best effort; editable on the 투자 page).
_CLASS_HINTS = [
    ("해외", "해외주식"), ("채권", "채권"), ("cma", "현금성"), ("mmf", "현금성"), ("rp", "현금성"),
    ("발행어음", "현금성"), ("금", "원자재"), ("리츠", "부동산"), ("주식", "국내주식"),
]


def asset_class_for(product_type: str, name: str) -> str:
    text = f"{product_type} {name}".lower()
    for hint, cls in _CLASS_HINTS:
        if hint in text:
            return cls
    return "기타"


def ensure_account(session: Session, name: str, kind: str | None = None) -> tuple[Account, bool]:
    acc = session.exec(select(Account).where(Account.name == name)).first()
    if acc:
        return acc, False
    kind = kind or infer_account_kind(name)
    acc = Account(name=name, kind=kind, issuer=infer_issuer(name) if kind in ("card", "check_card") else None)
    session.add(acc)
    session.flush()
    return acc, True


def store_banksalad_holdings(session: Session, items: list[Investment], as_of) -> None:
    """Replace Banksalad-sourced holdings with the newest export's list."""
    latest = session.exec(select(func.max(BalanceSnapshot.as_of))).one()
    if latest and as_of and as_of < latest:
        return  # an older export; keep what the newer one said
    session.exec(delete(Holding).where(Holding.source == "banksalad"))
    now = datetime.now()
    for it in items:
        session.add(Holding(
            account=it.company, name=it.name, asset_class=asset_class_for(it.product_type, it.name),
            cost=it.cost, value=it.value, updated_at=now, source="banksalad", note=it.product_type,
        ))
    session.flush()
    snapshot_holdings(session, as_of)


def snapshot_holdings(session: Session, as_of) -> None:
    holdings = session.exec(select(Holding)).all()
    snap = session.exec(select(HoldingSnapshot).where(HoldingSnapshot.as_of == as_of)).first()
    snap = snap or HoldingSnapshot(as_of=as_of, cost=0, value=0)
    snap.cost = sum(h.cost for h in holdings)
    snap.value = sum(h.value for h in holdings)
    if snap.cost or snap.value or snap.id:
        session.add(snap)


def import_banksalad(session: Session, data: bytes, filename: str) -> dict:
    export = parse_export(data, filename)
    sha = hashlib.sha256(data).hexdigest()
    seen_before = session.exec(select(ImportBatch).where(ImportBatch.sha256 == sha)).first()

    batch = ImportBatch(
        source="banksalad", filename=filename, sha256=sha, imported_at=datetime.now(),
        period_start=export.period_start, period_end=export.period_end,
        rows_total=len(export.rows), rows_skipped=export.skipped,
    )
    session.add(batch)
    session.flush()

    accounts: dict[str, Account] = {}
    new_accounts = []
    for name in dict.fromkeys(r.account for r in export.rows):
        acc, created = ensure_account(session, name)
        accounts[name] = acc
        if created:
            new_accounts.append({"name": name, "kind": acc.kind})

    existing = {
        (k, o): tid
        for k, o, tid in session.exec(select(Txn.base_key, Txn.occurrence, Txn.id)).all()
    }
    new = early = 0
    start = ledger_start(session)
    for row, key in zip(export.rows, row_keys(export.rows)):
        if not keep(start, row.occurred_at):
            early += 1  # before the ledger's start date (설정 → 데이터 기간)
            continue
        if key in existing:
            # Same row seen in an earlier export: refresh Banksalad's labels, keep our edits.
            t = session.get(Txn, existing[key])
            t.src_type, t.src_cat, t.src_sub, t.src_memo = (
                row.src_type, row.src_cat, row.src_sub, row.memo,
            )
            session.add(t)
            continue
        session.add(
            Txn(
                account_id=accounts[row.account].id, occurred_at=row.occurred_at,
                amount=row.amount, currency=row.currency, merchant=row.merchant,
                src_type=row.src_type, src_cat=row.src_cat, src_sub=row.src_sub,
                src_memo=row.memo, base_key=key[0], occurrence=key[1], batch_id=batch.id,
                source="banksalad",
            )
        )
        new += 1
    batch.rows_new = new
    batch.rows_existing = len(export.rows) - new - early
    batch.rows_skipped += early

    # 재무현황 (balances) and 투자현황 (holdings) are the state at download time, whatever the
    # ledger period in the filename says — so they are dated today, not by period_end.
    snapshot_day = date.today()
    if export.balances:
        session.exec(delete(BalanceSnapshot).where(BalanceSnapshot.as_of == snapshot_day))
        # Two products can share a display name (e.g. two '종합매매' accounts): add them up.
        merged: dict[tuple[str, str, str], int] = {}
        for b in export.balances:
            key = (b.side, b.group, b.name)
            merged[key] = merged.get(key, 0) + b.amount
        for (side, group, name), amount in merged.items():
            session.add(
                BalanceSnapshot(
                    as_of=snapshot_day, side=side, group=group, name=name, amount=amount,
                )
            )
    store_banksalad_holdings(session, export.investments, snapshot_day)
    session.add(batch)
    session.commit()
    reprocess(session)

    return {
        "batch_id": batch.id,
        "filename": filename,
        "period_start": export.period_start,
        "period_end": export.period_end,
        "rows_total": batch.rows_total,
        "rows_new": batch.rows_new,
        "rows_existing": batch.rows_existing,
        "rows_skipped": batch.rows_skipped,
        "new_accounts": new_accounts,
        "balances": len(export.balances),
        "investments": len(export.investments),
        "already_imported": seen_before is not None,
    }
