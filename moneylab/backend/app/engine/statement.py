"""Check the ledger against a real bank statement (거래내역 with a running 잔액 column).

Every statement row is looked for in MoneyLab:
  1. on the same account (same amount, within 2 days)                → matched
  2. on a 체크카드 / 간편결제 account (Banksalad books those payments
     there, not on the bank account that actually paid)              → paid via, linked
  3. nowhere                                                         → missing
MoneyLab rows on the account with no statement row are "extra" (duplicates or mistakes).
Month-end balances from the statement become balance checks, so the 잔액 검증 view
stays exact afterwards.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.engine.ledger import ledger_start
from app.ingest import generic as G
from app.ingest.banksalad import ExportFormatError
from app.models import Account, BalanceCheck, Txn

WINDOW = timedelta(days=2)
NOTE = "통장 거래내역"


def _statement_rows(data: bytes, filename: str) -> list[dict]:
    table = G.read_table(data, filename)
    h = G.find_header(table)
    head = [G._t(c) for c in table[h]]
    m = G.guess_mapping(table[h])
    bal_i = next((i for i, c in enumerate(head) if "잔액" in c.replace(" ", "")), None)
    if m.get("date") is None or (m.get("out") is None and m.get("in") is None and m.get("amount") is None):
        raise ExportFormatError("날짜와 금액 열을 찾지 못했어요.")
    def cell(r, key):
        i = m.get(key)
        return r[i] if i is not None and i < len(r) else None

    rows = []
    for r in table[h + 1:]:
        when = G.parse_when(cell(r, "date"), cell(r, "time"))
        if not when:
            continue
        if m.get("out") is not None or m.get("in") is not None:
            amount = (G.parse_amount(cell(r, "in")) or 0) - abs(G.parse_amount(cell(r, "out")) or 0)
        else:
            amount = G.parse_amount(cell(r, "amount")) or 0
            if m.get("sign") == "expense_positive":
                amount = -amount
        if not amount:
            continue
        bal = G.parse_amount(r[bal_i]) if bal_i is not None and bal_i < len(r) else None
        rows.append({"at": when, "amount": amount, "who": G._t(cell(r, "merchant")),
                     "memo": G._t(cell(r, "memo")) or None, "balance": bal})
    # Statements list newest first and same-second rows in posting order: keep that order
    # (reversed) so the last row of a day carries that day's closing balance.
    if rows and rows[0]["at"] > rows[-1]["at"]:
        rows.reverse()
    rows.sort(key=lambda x: x["at"])
    return rows


def reconcile(session: Session, account_id: int, data: bytes, filename: str, apply: bool = True) -> dict:
    account = session.get(Account, account_id)
    if not account:
        raise ExportFormatError("계좌를 찾을 수 없어요.")
    stmt = _statement_rows(data, filename)
    if not stmt:
        raise ExportFormatError("거래를 읽지 못했어요.")

    own = session.exec(select(Txn).where(Txn.account_id == account_id, Txn.provisional == False)).all()
    if not own:
        raise ExportFormatError("이 계좌에는 MoneyLab 기록이 아직 없어요.")
    start = min(t.occurred_at for t in own).date()
    # With a ledger start date, everything from that day on should be here.
    if (ls := ledger_start(session)) and ls < start:
        start = ls
    # Up to the newest data of any account: a quiet bank account can still have card rows later.
    end = session.exec(select(func.max(Txn.occurred_at)).where(Txn.provisional == False)).one().date()
    in_range = [s for s in stmt if start <= s["at"].date() <= end]

    payers = {a.id: a for a in session.exec(
        select(Account).where(col(Account.kind).in_(("check_card", "pay")))
    ).all()}
    others = session.exec(select(Txn).where(col(Txn.account_id).in_(list(payers)), Txn.provisional == False)).all() if payers else []

    by_amount: dict[int, list[Txn]] = defaultdict(list)
    for t in own:
        by_amount[t.amount].append(t)
    other_by_amount: dict[int, list[Txn]] = defaultdict(list)
    for t in others:
        other_by_amount[t.amount].append(t)

    used: set[int] = set()

    def take(pool: list[Txn], s: dict) -> Txn | None:
        best = None
        for t in pool:
            if t.id in used:
                continue
            gap = abs(t.occurred_at - s["at"])
            if gap <= WINDOW and (best is None or gap < best[0]):
                best = (gap, t)
        if best:
            used.add(best[1].id)
            return best[1]
        return None

    matched, via, missing = 0, [], []
    for s in in_range:
        if take(by_amount.get(s["amount"], []), s):
            matched += 1
            continue
        t = take(other_by_amount.get(s["amount"], []), s)
        if t:
            via.append((s, t))
        else:
            missing.append(s)
    extra = [t for t in own if t.id not in used and start <= t.occurred_at.date() <= end
             and stmt[0]["at"].date() <= t.occurred_at.date() <= stmt[-1]["at"].date()]

    before = [s for s in stmt if s["at"].date() < start]
    month_end: dict[str, dict] = {}
    for s in stmt:
        if s["balance"] is not None:
            month_end[s["at"].strftime("%Y-%m")] = s  # rows are sorted: last one wins

    if apply:
        for s, t in via:
            if t.funded_by != account_id:
                t.funded_by = account_id
                session.add(t)
        for old in session.exec(select(BalanceCheck).where(
            BalanceCheck.account_id == account_id, BalanceCheck.note == NOTE
        )).all():
            session.delete(old)
        days = {s["at"].date(): s["balance"] for s in month_end.values()}
        if before and before[-1]["balance"] is not None:
            days[before[-1]["at"].date()] = before[-1]["balance"]  # balance just before MoneyLab's data
        for d, bal in days.items():
            if d >= start - timedelta(days=1):  # only where the ledger can be compared
                session.add(BalanceCheck(account_id=account_id, on_date=d, amount=bal, note=NOTE))
        session.commit()

    def row(s: dict) -> dict:
        return {"date": s["at"].isoformat(sep=" ", timespec="minutes"), "merchant": s["who"], "memo": s["memo"],
                "amount": s["amount"]}

    return {
        "account": account.label or account.name,
        "statement": {"rows": len(stmt), "first": stmt[0]["at"].date(), "last": stmt[-1]["at"].date(),
                      "last_balance": stmt[-1]["balance"]},
        "ledger": {"rows": len(own), "first": start, "last": end},
        "compared": len(in_range),
        "matched": matched,
        "via_other": [{**row(s), "booked_on": payers[t.account_id].label or payers[t.account_id].name,
                       "booked_as": t.merchant} for s, t in via],
        "via_other_total": sum(s["amount"] for s, _ in via),
        "missing": [row(s) for s in missing],
        "missing_total": sum(s["amount"] for s in missing),
        "extra": [{"date": t.occurred_at.isoformat(sep=" ", timespec="minutes"), "merchant": t.merchant,
                   "amount": t.amount, "id": t.id} for t in extra],
        "before": {"rows": len(before), "first": before[0]["at"].date() if before else None,
                   "last": before[-1]["at"].date() if before else None,
                   "balance": before[-1]["balance"] if before else None},
        "checks_added": len(month_end) if apply else 0,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }
