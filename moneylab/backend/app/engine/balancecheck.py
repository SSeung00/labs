"""Test the ledger against balances read off real statements.

Everything is anchored on one known balance (the latest of: the Banksalad 재무현황 balance,
or a balance the user entered). Walking the ledger from there gives an implied balance for
any day. Where a real statement disagrees, the difference says how much money moved without
being recorded — and comparing two checks narrows down *when*.

All rows on the account count here, including ones marked as cross-account duplicates
(that flag is about not double-counting spending, the money still moved on this account).
Live notification rows are left out: they aren't in the bank's ledger yet.
"""

from collections import defaultdict
from datetime import date, timedelta
from itertools import pairwise

from sqlmodel import Session, col, select

from app.models import Account, BalanceCheck, BalanceSnapshot, Txn


def _daily_net(session: Session, account_id: int) -> dict[date, int]:
    """Money in/out of this account per day — including payments Banksalad books on the
    paying instrument (체크카드, 간편결제) when they actually leave this account."""
    feeders = {a.id for a in session.exec(select(Account).where(Account.funding_account_id == account_id)).all()}
    rows = session.exec(
        select(Txn.account_id, Txn.occurred_at, Txn.amount, Txn.funded_by).where(
            Txn.provisional == False,
            (Txn.account_id == account_id) | (Txn.funded_by == account_id) | col(Txn.account_id).in_(feeders),
        )
    ).all()
    # Banksalad sometimes books a check-card row on *both* the card and the bank (a refund,
    # or 후불교통 that leaves the bank days later): a feeder row only counts when no
    # same-amount bank row within a week is left to pair it with. Rows the statement check
    # tied to this account (funded_by) always count.
    own: dict[int, list[date]] = defaultdict(list)
    for acc, at, amount, _ in rows:
        if acc == account_id:
            own[amount].append(at.date())
    net: dict[date, int] = defaultdict(int)
    for acc, at, amount, funded in rows:
        d = at.date()
        if acc != account_id and funded != account_id:
            near = [o for o in own.get(amount, []) if abs((o - d).days) <= 7]
            if near:
                own[amount].remove(min(near, key=lambda o: abs((o - d).days)))
                continue
        net[d] += amount
    return net


def anchor(session: Session, account: Account) -> dict | None:
    snap = session.exec(
        select(BalanceSnapshot).where(BalanceSnapshot.name == account.name, BalanceSnapshot.side == "asset")
        .order_by(col(BalanceSnapshot.as_of).desc())
    ).first()
    check = session.exec(
        select(BalanceCheck).where(BalanceCheck.account_id == account.id).order_by(col(BalanceCheck.on_date).desc())
    ).first()
    options = []
    if snap:
        options.append({"date": snap.as_of, "amount": snap.amount, "source": "banksalad"})
    if check:
        options.append({"date": check.on_date, "amount": check.amount, "source": "check", "check_id": check.id})
    return max(options, key=lambda o: o["date"]) if options else None


def implied_on(net: dict[date, int], anchor_date: date, anchor_amount: int, day: date) -> int:
    """Balance at the end of `day` implied by the ledger."""
    if day <= anchor_date:
        return anchor_amount - sum(v for d, v in net.items() if day < d <= anchor_date)
    return anchor_amount + sum(v for d, v in net.items() if anchor_date < d <= day)


def report(session: Session, account_id: int) -> dict:
    account = session.get(Account, account_id)
    if not account:
        raise ValueError("계좌를 찾을 수 없어요.")
    a = anchor(session, account)
    net = _daily_net(session, account_id)
    checks = session.exec(
        select(BalanceCheck).where(BalanceCheck.account_id == account_id).order_by(BalanceCheck.on_date)
    ).all()
    if not a:
        return {"account": {"id": account.id, "name": account.label or account.name}, "anchor": None,
                "checks": [], "intervals": [], "monthly": [], "first_date": None}

    rows = []
    for c in checks:
        imp = implied_on(net, a["date"], a["amount"], c.on_date)
        rows.append({"id": c.id, "on_date": c.on_date, "actual": c.amount, "implied": imp,
                     "diff": c.amount - imp, "note": c.note, "is_anchor": a.get("check_id") == c.id})

    # Consecutive known points (checks + the anchor) → unrecorded money per interval.
    points = [(r["on_date"], r["diff"]) for r in rows]
    if a["source"] == "banksalad":
        points.append((a["date"], 0))
    points.sort()
    intervals = []
    for (d1, x1), (d2, x2) in pairwise(points):
        if d1 == d2:
            continue
        delta = x2 - x1
        intervals.append({"from": d1, "to": d2, "unrecorded": delta,
                          "ok": abs(delta) < 1000})

    first = min(net) if net else None
    monthly = []
    if first:
        d = date(first.year, first.month, 1)
        last_day = max(max(net), a["date"])
        while d <= last_day:
            nxt = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
            end = min(nxt - timedelta(days=1), last_day)
            monthly.append({"date": end, "implied": implied_on(net, a["date"], a["amount"], end)})
            d = nxt
    opening = implied_on(net, a["date"], a["amount"], first - timedelta(days=1)) if first else None
    lowest = min(monthly, key=lambda m: m["implied"]) if monthly else None
    return {
        "account": {"id": account.id, "name": account.label or account.name, "kind": account.kind},
        "anchor": a,
        "first_date": first,
        "opening_implied": opening,
        "negative": lowest if lowest and lowest["implied"] < 0 else None,
        "checks": rows,
        "intervals": intervals,
        "monthly": monthly,
    }


def add_check(session: Session, account_id: int, on_date: date, amount: int, note: str | None) -> BalanceCheck:
    c = BalanceCheck(account_id=account_id, on_date=on_date, amount=amount, note=note)
    session.add(c)
    session.commit()
    session.refresh(c)
    return c

