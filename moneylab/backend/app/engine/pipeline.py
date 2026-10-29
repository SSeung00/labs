"""Re-derive kind / category / duplicate / trip for every row.

Cheap enough (a few thousand rows) to run in full after every import or rule/trip edit,
which keeps the logic simple: hand-set fields are *_locked and skipped, everything else is
recomputed from the source labels.
"""

from collections import defaultdict
from datetime import timedelta

from sqlmodel import Session, select

from app.engine.categories import refine
from app.engine.classify import auto_category, auto_kind, compile_rule, match_rule
from app.engine.dedupe import Item, find_duplicates
from app.engine.trips import TripWindow, assign_trip
from app.models import Account, Category, Rule, Trip, Txn

# Spending we can't tell apart (PG names like 이니시스/NICE land in 기타·금융): review + AI targets.
VAGUE_CATEGORIES = ("미분류", "기타")
PROVISIONAL_WINDOW = timedelta(days=4)
INVEST_PAIR_WINDOW = timedelta(days=2)


def compiled_rules(session: Session):
    rules = session.exec(
        select(Rule).where(Rule.enabled == True).order_by(Rule.priority, Rule.id)
    ).all()
    out = []
    for r in rules:
        c = compile_rule(r.id, r.pattern, r.account_kind, r.set_category, r.set_kind)
        if c:
            out.append(c)
    return out


def supersede_provisional(txns: list[Txn]) -> dict[int, int]:
    """{provisional_id: confirmed_id} — a live notification confirmed by an export row."""
    confirmed: dict[tuple[int, int], list[Txn]] = defaultdict(list)
    for t in txns:
        if not t.provisional:
            confirmed[(t.account_id, t.amount)].append(t)
    used: set[int] = set()
    out: dict[int, int] = {}
    for p in sorted((t for t in txns if t.provisional), key=lambda t: t.occurred_at):
        best, gap = None, PROVISIONAL_WINDOW
        for c in confirmed.get((p.account_id, p.amount), ()):
            d = abs(c.occurred_at - p.occurred_at)
            if c.id not in used and d <= gap:
                best, gap = c, d
        if best:
            used.add(best.id)
            out[p.id] = best.id
    return out


def pair_invest_transfers(txns: list[Txn], kinds: dict[int, str]) -> set[int]:
    """Bank-side rows whose money also shows up on a connected brokerage account.

    Counting both would double the contribution, so the bank side becomes a plain transfer.
    """
    inflows: dict[int, list[Txn]] = defaultdict(list)
    for t in txns:
        if t.kind == "invest" and kinds[t.account_id] == "invest" and t.amount > 0:
            inflows[t.amount].append(t)
    used: set[int] = set()
    out: set[int] = set()
    for t in txns:
        if t.kind != "invest" or kinds[t.account_id] == "invest" or t.amount >= 0 or t.kind_locked:
            continue
        for c in inflows.get(-t.amount, ()):
            if c.id not in used and abs(c.occurred_at - t.occurred_at) <= INVEST_PAIR_WINDOW:
                used.add(c.id)
                out.add(t.id)
                break
    return out


def reprocess(session: Session) -> None:
    kinds = {a.id: a.kind for a in session.exec(select(Account)).all()}
    rules = compiled_rules(session)
    rules_by_id = {r.id: r for r in rules}
    fixed = {c.name for c in session.exec(select(Category)).all() if c.group == "고정비"}
    trips = [
        TripWindow(t.id, t.start_date, t.end_date, t.kind == "event")
        for t in session.exec(select(Trip).order_by(Trip.start_date)).all()
    ]
    txns = session.exec(select(Txn)).all()

    for t in txns:
        ak = kinds[t.account_id]
        kind = t.kind if t.kind_locked else auto_kind(t.src_type, t.merchant, ak)
        rule = match_rule(rules, t.merchant, ak, kind)
        if rule and rule.set_kind and not t.kind_locked:
            kind = rule.set_kind
        if t.claim_id:
            kind = "claim"  # 정산 rows are never my spending or income
        t.kind = kind
        t.rule_id = rule.id if rule else None

    paired = pair_invest_transfers(txns, kinds)
    for t in txns:
        if t.id in paired:
            t.kind = "transfer"
        if not t.category_locked:
            rule = rules_by_id.get(t.rule_id) if t.rule_id else None
            text = f"{t.merchant} {t.title or ''}"
            if rule and rule.set_category and t.kind in ("expense", "income"):
                t.category = refine(rule.set_category, t.src_cat, t.src_sub, text)
            else:
                t.category = auto_category(t.kind, t.src_cat, t.src_sub, text)
        if t.kind != "expense" or t.category not in VAGUE_CATEGORIES or t.category_locked:
            t.ai_category = t.ai_reason = None  # a suggestion is only useful while uncategorised

    superseded = supersede_provisional(txns)
    dups = find_duplicates(
        [
            Item(
                id=t.id, account_id=t.account_id, account_kind=kinds[t.account_id],
                occurred_at=t.occurred_at, amount=t.amount, merchant=t.merchant,
                # 정산 payments are still payments: their card-side copy is a duplicate too.
                eligible=(t.kind == "expense" or (t.kind == "claim" and t.amount < 0))
                and not t.dup_locked and not t.provisional,
            )
            for t in txns
        ]
    )
    for t in txns:
        if t.provisional:
            t.dup_of_id = superseded.get(t.id)
        elif not t.dup_locked:
            t.dup_of_id = dups.get(t.id)
        if not t.trip_locked:
            spending = t.kind == "expense" and t.dup_of_id is None
            t.trip_id = (
                assign_trip(t.occurred_at.date(), t.category, fixed, trips) if spending else None
            )
        session.add(t)
    session.commit()
