"""Cross-account duplicates Banksalad leaves in.

A 간편결제/체크카드 row (real merchant name) sometimes also shows up on the funding card or
bank account, often under the payment gateway's name ("네이버페이", "NICE_통신판매").
We keep the pay-side row and mark the other as its duplicate.
"""

import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime

MAX_DAYS = 3

PRIMARY_KINDS = {"pay", "check_card"}
SECONDARY_KINDS = {"card", "bank", "other"}

PAYMENT_GATEWAY = re.compile(
    r"네이버페이|naverpay|카카오페이|kakaopay|페이코|payco|토스페이|tosspay|_간편|간편결제|nice|kcp"
    r"|이니시스|inicis|kicc|ksnet|다날|danal|한국결제|adyen|stripe|paypal|통신판매",
    re.IGNORECASE,
)
_NOISE = re.compile(r"\(주\)|㈜|주식회사|_간편|_오프라인|_온라인|[\s\W_]+")


@dataclass
class Item:
    id: int
    account_id: int
    account_kind: str
    occurred_at: datetime
    amount: int
    merchant: str
    eligible: bool  # expense row, not hand-locked as "not a duplicate"


def normalize(s: str) -> str:
    return _NOISE.sub("", s.lower())


def similar(primary: str, secondary: str) -> bool:
    a, b = normalize(primary), normalize(secondary)
    if a and b and (a == b or (min(len(a), len(b)) >= 2 and (a in b or b in a))):
        return True
    return bool(PAYMENT_GATEWAY.search(secondary))


def find_duplicates(items: list[Item]) -> dict[int, int]:
    """{duplicate_id: kept_id}"""
    by_amount: dict[int, list[Item]] = defaultdict(list)
    for it in items:
        if it.eligible and it.account_kind in SECONDARY_KINDS:
            by_amount[it.amount].append(it)

    used: set[int] = set()
    out: dict[int, int] = {}
    primaries = sorted(
        (it for it in items if it.eligible and it.account_kind in PRIMARY_KINDS),
        key=lambda it: it.occurred_at,
    )
    for a in primaries:
        best: Item | None = None
        best_gap = float("inf")
        for b in by_amount.get(a.amount, ()):
            if b.id in used or b.account_id == a.account_id:
                continue
            gap = abs((b.occurred_at - a.occurred_at).total_seconds()) / 86400
            if gap > MAX_DAYS or gap >= best_gap or not similar(a.merchant, b.merchant):
                continue
            best, best_gap = b, gap
        if best:
            used.add(best.id)
            out[best.id] = a.id
    return out
