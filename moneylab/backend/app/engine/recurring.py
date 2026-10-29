"""Find subscriptions and other recurring payments in the ledger.

A merchant counts as recurring when it was paid at least three times at a steady rhythm
(weekly, monthly or yearly) for a steady amount. No rules to maintain; the user can hide
false positives.
"""

import json
import re
from calendar import monthrange
from collections import defaultdict
from datetime import date, datetime, timedelta
from itertools import pairwise
from statistics import median

from sqlmodel import Session, col, select

from app.engine.budget import get_setting, put_setting
from app.engine.dedupe import normalize
from app.models import Txn

LOOKBACK_DAYS = 400
IGNORED_KEY = "recurring.ignored"

CADENCES = [
    # name, min gap, max gap, months per payment
    ("weekly", 5, 9, 12 / 52),
    ("monthly", 25, 36, 1),
    ("yearly", 330, 400, 12),
]


def ignored(session: Session) -> set[str]:
    try:
        return set(json.loads(get_setting(session, IGNORED_KEY, "[]") or "[]"))
    except json.JSONDecodeError:
        return set()


def set_ignored(session: Session, key: str, on: bool) -> None:
    keys = ignored(session)
    (keys.add if on else keys.discard)(key)
    put_setting(session, IGNORED_KEY, json.dumps(sorted(keys), ensure_ascii=False))
    session.commit()


def _add_month(d: date, n: int = 1) -> date:
    idx = d.year * 12 + d.month - 1 + n
    y, m = idx // 12, idx % 12 + 1
    return date(y, m, min(d.day, monthrange(y, m)[1]))


# One service billed under several merchant texts (a new card, a renamed billing entity):
# ANTHROPIC, PBC / ANTHROPIC* CLAUDE SUB / CLAUDE.AI SUBSCRIPTION are the same subscription.
BRANDS = [
    (re.compile(r"anthropic|claude", re.IGNORECASE), "claude"),
    (re.compile(r"openai|chatgpt", re.IGNORECASE), "chatgpt"),
    (re.compile(r"cursor", re.IGNORECASE), "cursor"),
    (re.compile(r"기후동행"), "기후동행카드"),
]


def series_key(merchant: str) -> str:
    return next((key for rx, key in BRANDS if rx.search(merchant)), None) or normalize(merchant)


def detect(session: Session, today: date | None = None, include_ignored: bool = False) -> list[dict]:
    today = today or date.today()
    since = datetime.combine(today - timedelta(days=LOOKBACK_DAYS), datetime.min.time())
    rows = session.exec(
        select(Txn).where(
            Txn.kind == "expense", col(Txn.dup_of_id).is_(None), Txn.amount < 0, Txn.occurred_at >= since,
        ).order_by(Txn.occurred_at)
    ).all()
    groups: dict[str, list[Txn]] = defaultdict(list)
    for t in rows:
        key = series_key(t.merchant)
        if key:
            groups[key].append(t)

    hidden = ignored(session)
    out = []
    for key, txns in groups.items():
        # One payment per day at most (split charges on the same day are one bill).
        by_day: dict[date, int] = defaultdict(int)
        for t in txns:
            by_day[t.occurred_at.date()] += -t.amount
        days = sorted(by_day)
        if len(days) < 3:
            continue
        gaps = [(b - a).days for a, b in pairwise(days)]
        g = median(gaps)
        cadence = next((c for c in CADENCES if c[1] <= g <= c[2]), None)
        if not cadence:
            continue
        on_rhythm = sum(1 for x in gaps if cadence[1] <= x <= cadence[2]) / len(gaps)
        amounts = [by_day[d] for d in days]
        typical = median(amounts)
        steady = sum(1 for a in amounts if abs(a - typical) <= typical * 0.25) / len(amounts)
        if on_rhythm < 0.6 or steady < 0.6:
            continue
        last = days[-1]
        if cadence[0] == "monthly":
            nxt = _add_month(last)
        elif cadence[0] == "yearly":
            nxt = _add_month(last, 12)
        else:
            nxt = last + timedelta(days=7)
        active = (today - last).days <= g * 1.6
        latest = txns[-1]
        item = {
            "key": key,
            "merchant": latest.merchant,
            "category": latest.category,
            "account_id": latest.account_id,
            "cadence": cadence[0],
            "amount": round(typical),
            "last_amount": by_day[last],
            "count": len(days),
            "first_date": days[0].isoformat(),
            "last_date": last.isoformat(),
            "next_date": nxt.isoformat(),
            "day_of_month": last.day if cadence[0] == "monthly" else None,
            "active": active,
            "monthly_cost": round(typical / cadence[3]) if cadence[0] != "weekly" else round(typical * 52 / 12),
            "yearly_cost": round(typical * (12 / cadence[3])) if cadence[0] != "weekly" else round(typical * 52),
            "ignored": key in hidden,
        }
        if item["ignored"] and not include_ignored:
            continue
        out.append(item)
    return sorted(out, key=lambda r: (not r["active"], -r["monthly_cost"]))


def upcoming(items: list[dict], today: date | None = None, days: int = 45) -> list[dict]:
    """Expected charges in the next `days` days (monthly ones may appear twice)."""
    today = today or date.today()
    end = today + timedelta(days=days)
    out = []
    for it in items:
        if not it["active"]:
            continue
        d = date.fromisoformat(it["next_date"])
        while d < today:  # overdue / not yet imported: roll forward
            d = _add_month(d, 12 if it["cadence"] == "yearly" else 1) if it["cadence"] != "weekly" else d + timedelta(days=7)
        while d <= end:
            out.append({"date": d.isoformat(), "merchant": it["merchant"], "amount": it["amount"],
                        "category": it["category"], "key": it["key"]})
            if it["cadence"] == "yearly":
                break
            d = _add_month(d) if it["cadence"] == "monthly" else d + timedelta(days=7)
    return sorted(out, key=lambda r: r["date"])
