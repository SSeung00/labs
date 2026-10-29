"""Carry over what a hand-kept ledger knew about rows MoneyLab already has.

The old ledger (CSV: Type, Date, Amount, Title, Category, Place, Account, …, Events, Note)
was typed in by hand, so it knows things the bank data can't: what a payment was for, which
incoming transfers were friends paying their share (SettleIn) or a lab paying me back
(Reimb.), which event a payment belonged to and whether it was mine (Note "개인 소비") or for
the group, and which purchases a government voucher paid for (₩0 rows, "6500, 고유가지원금").

Nothing is imported as new spending: each CSV row is matched to the existing row (same
amount, within a few days, preferring the same account) and only annotates it:

- title ← Title (the name shown instead of the merchant), note ← Note, when not set yet
- SettleIn / SettleOut / Refund / Reimb. outside an event → spending in that category
  (a friend's share coming back lowers what the meal cost me)
- Income → income (과외비, 용돈 …)
- Events → a Trip (travel) or an event + its Claim: group payments and paybacks go in the
  claim, "개인" rows stay my spending at the event
- voucher-paid purchases → an offsetting row on a hidden "지원금" account, so the purchase
  keeps its category but costs nothing
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlmodel import Session, select

from app.engine.categories import parent_of, refine
from app.engine.pipeline import VAGUE_CATEGORIES, reprocess
from app.models import Account, Claim, Trip, Txn

VOUCHER_ACCOUNT = "지원금(소비쿠폰)"
WINDOW = timedelta(days=3)
OFFSET_TYPES = ("SettleIn", "SettleOut", "Refund", "Reimb.")
HOBBY = ("러닝", "운동", "카메라", "학회·행사")  # 대분류

CATEGORY = {
    "food": "식비", "conf": "학회·행사", "fitness": "운동", "mobility": "교통", "culture": "문화·여가",
    "health": "건강·미용", "gifts": "경조·선물", "travel": "숙소", "finance": "카드·금융 수수료", "etc": "기타",
    "work": "구독", "income": "기타수입",
}
RUNNING = re.compile(
    r"마라톤|marathon|러닝|런닝|런(?![가-힣])|\brun|하프|full|\d+k\b|1080|아식스|asics|달리샤|가민|garmin"
    r"|adizero|boston|알파플라이|vaporfly|베이퍼|endorphin|엔돌핀",
    re.IGNORECASE,
)
INCOME = [
    (re.compile(r"tutoring|과외", re.IGNORECASE), "과외"),
    (re.compile(r"\bsup\b|support|지원|용돈", re.IGNORECASE), "용돈·지원"),
    (re.compile(r"funding|급여|월급", re.IGNORECASE), "급여"),
    (re.compile(r"이자"), "금융수입"),
]
VOUCHER = re.compile(r"^\s*([\d,]+)\s*,\s*(.*(?:지원금|쿠폰).*?)\s*$")
# Old account names → words in MoneyLab account names (for tie-breaking only).
ACCOUNT_HINTS = {
    "samsung card": ("삼성카드",), "checking": ("신한", "Deep Dream", "간편결제"),
    "kakao pay": ("카카오페이",), "saving": ("청년도약",),
}


@dataclass
class Row:
    type: str
    at: datetime
    amount: int  # signed, as it hit my account
    title: str
    place: str
    category: str  # mapped to ours
    raw_category: str
    account: str
    event: str
    note: str
    voucher: tuple[int, str] | None = None


@dataclass
class Result:
    rows: int = 0
    matched: int = 0
    notes: int = 0
    kinds: dict[str, int] = field(default_factory=dict)
    categories: int = 0
    events: dict[str, dict] = field(default_factory=dict)
    vouchers: int = 0
    unmatched: list[dict] = field(default_factory=list)

    def bump(self, key: str) -> None:
        self.kinds[key] = self.kinds.get(key, 0) + 1


def _won(s: str) -> int:
    s = (s or "").replace("₩", "").replace(",", "").strip()
    neg = s.startswith("-")
    n = int(s.lstrip("-") or 0)
    return -n if neg else n


def _category(raw: str, title: str) -> str:
    key = raw.split(maxsplit=1)[-1].strip().lower() if raw.strip() else ""
    cat = CATEGORY.get(key, "기타")
    if cat == "운동" and RUNNING.search(title):
        cat = "러닝"
    return cat


def parse(data: bytes) -> list[Row]:
    text = data.decode("utf-8-sig")
    out = []
    for r in csv.DictReader(io.StringIO(text)):
        if not r.get("Type") or not r.get("Date"):
            continue
        at = datetime.strptime(r["Date"], "%Y-%m-%d, %H:%M:%S")
        amount = _won(r.get("Account Impact", "")) or _won(r.get("From Account Impact", ""))
        note = (r.get("Note") or "").strip()
        v = VOUCHER.match(note)
        out.append(Row(
            type=r["Type"], at=at, amount=amount, title=(r.get("Title") or "").strip(),
            place=(r.get("Place") or "").strip(),
            category=_category(r.get("Category") or "", r.get("Title") or ""),
            raw_category=r.get("Category") or "", account=(r.get("Account") or r.get("From Account") or "").strip(),
            event=(r.get("Events") or "").strip(), note=note,
            voucher=(int(v.group(1).replace(",", "")), v.group(2)) if v else None,
        ))
    return out


def _same_place(r: Row, merchant: str) -> bool:
    m = merchant.lower()
    words = re.findall(r"[0-9a-z가-힣]{2,}", f"{r.place} {r.title}".lower())
    return any(w in m for w in words if w not in ("주식회사", "카카오페이", "kakao", "pay", "네이버페이"))


def _match(rows: list[Row], txns: list[Txn], names: dict[int, str]) -> list[tuple[Row, Txn | None]]:
    by_amount: dict[int, list[Txn]] = {}
    for t in txns:
        by_amount.setdefault(t.amount, []).append(t)
    used: set[int] = set()

    def pick(r: Row, amount: int, fuzzy: bool = False, by_name: bool = False) -> Txn | None:
        hints = ACCOUNT_HINTS.get(r.account.lower(), ())
        pool = by_amount.get(amount, []) if not fuzzy else [
            t for t in txns if amount and t.amount * amount > 0 and abs(t.amount - amount) <= abs(amount) * 0.03
        ]
        best, best_score = None, None
        for t in pool:
            if t.id in used or abs(t.occurred_at - r.at) > WINDOW:
                continue
            if by_name and (t.dup_of_id or not _same_place(r, t.merchant)):
                continue
            score = abs((t.occurred_at - r.at).total_seconds())
            if any(h in names[t.account_id] for h in hints):
                score -= 1e6
            if t.dup_of_id:
                score += 1e7
            if best_score is None or score < best_score:
                best, best_score = t, score
        if best:
            used.add(best.id)
        return best

    todo = []
    for r in rows:
        if r.type == "Transfer":
            continue
        # A voucher-paid row: the card charged the amount plus what the voucher covered.
        target = r.amount - r.voucher[0] if r.voucher and r.type == "Expense" else r.amount
        if target:
            todo.append((r, target))

    out: list[tuple[Row, Txn | None]] = []
    # Rows whose place name shows up in the merchant first: with two same-amount payments a
    # day apart, the name is what tells them apart. Then by amount and date alone, then
    # overseas card rows, where the old ledger used another FX amount.
    for how in ({"by_name": True}, {}, {"fuzzy": True}):
        left = []
        for r, target in todo:
            t = pick(r, target, **how)
            (out.append((r, t)) if t else left.append((r, target)))
        todo = left
    out.extend((r, None) for r, _ in todo)
    return out


def _voucher_account(session: Session) -> Account:
    acc = session.exec(select(Account).where(Account.name == VOUCHER_ACCOUNT)).first()
    if not acc:
        acc = Account(name=VOUCHER_ACCOUNT, kind="other", hidden=True)
        session.add(acc)
        session.flush()
    return acc


def apply(session: Session, data: bytes, events: dict[str, int], dry_run: bool = False) -> Result:
    """events: old event name → Trip id (create the trips first; unknown events are left alone)."""
    rows = parse(data)
    res = Result(rows=len(rows))
    names = {a.id: a.name for a in session.exec(select(Account)).all()}
    txns = list(session.exec(select(Txn).where(Txn.provisional == False)).all())
    trips = {tid: session.get(Trip, tid) for tid in set(events.values())}
    claims: dict[str, Claim] = {}

    def claim_for(event: str) -> Claim:
        if event not in claims:
            trip = trips[events[event]]
            name = f"{trip.name} 정산"
            c = session.exec(select(Claim).where(Claim.name == name)).first()
            if not c:
                c = Claim(name=name, kind="reimburse", trip_id=trip.id, created_at=datetime.now())
                session.add(c)
                session.flush()
            claims[event] = c
        return claims[event]

    for r, t in _match(rows, txns, names):
        if t is None:
            res.unmatched.append({"date": r.at, "type": r.type, "amount": r.amount, "title": r.title})
            continue
        res.matched += 1
        if not t.title and r.title:
            t.title = r.title
            res.notes += 1
        if not t.note and r.note and not r.voucher:
            t.note = r.note

        trip = trips.get(events.get(r.event)) if r.event in events else None
        if trip and trip.kind == "travel":
            if t.amount < 0 or r.type == "Refund":
                t.trip_id, t.trip_locked = trip.id, True
                res.events.setdefault(r.event, {"trip": 0, "claim": 0})["trip"] += 1
        elif trip:
            stats = res.events.setdefault(r.event, {"trip": 0, "claim": 0})
            if r.type == "Expense" and "개인" in r.note:
                t.trip_id, t.trip_locked = trip.id, True
                stats["trip"] += 1
            else:
                t.claim_id = claim_for(r.event).id
                stats["claim"] += 1
        elif r.type in OFFSET_TYPES and r.category != "기타수입":
            t.kind, t.kind_locked = "expense", True
            t.category, t.category_locked = refine(r.category, t.src_cat, t.src_sub, f"{t.merchant} {r.title}"), True
            res.bump(r.type)
        elif (r.type == "Income" or r.type in OFFSET_TYPES) and t.amount >= 100 and t.kind != "income":
            t.kind, t.kind_locked = "income", True
            t.category = next((c for rx, c in INCOME if rx.search(r.title)), "기타수입")
            t.category_locked = True
            res.bump("Income")
        elif r.type == "Expense" and t.kind == "transfer" and t.amount < 0:
            # Sent to a person but really spending (축의금, 모임 회비, 단체 티셔츠 …).
            t.kind, t.kind_locked = "expense", True
            t.category, t.category_locked = refine(r.category, t.src_cat, t.src_sub, f"{t.merchant} {r.title}"), True
            res.bump("Expense")
        elif r.type == "Expense" and t.kind == "expense" and (
            t.category in VAGUE_CATEGORIES or (r.category in HOBBY and parent_of(t.category) not in HOBBY)
        ):
            t.category, t.category_locked = refine(r.category, t.src_cat, t.src_sub, f"{t.merchant} {r.title}"), True
            res.categories += 1

        if r.voucher and r.type == "Expense":
            key = hashlib.sha1(f"voucher|{t.id}".encode()).hexdigest()
            if not session.exec(select(Txn).where(Txn.base_key == key)).first():
                acc = _voucher_account(session)
                session.add(Txn(
                    account_id=acc.id, occurred_at=t.occurred_at + timedelta(seconds=1), amount=r.voucher[0],
                    merchant=f"{r.voucher[1]}: {t.merchant}", src_type="지출", source="manual",
                    base_key=key, occurrence=1, kind="expense", kind_locked=True,
                    category=t.category, category_locked=True, note=f"{r.voucher[1]}으로 결제한 금액",
                ))
                res.vouchers += 1
        session.add(t)

    if dry_run:
        session.rollback()
    else:
        session.commit()
        reprocess(session)
    return res
