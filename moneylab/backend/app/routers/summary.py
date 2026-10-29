from collections import defaultdict
from datetime import date, datetime, timedelta

from fastapi import APIRouter
from sqlalchemy import case, func
from sqlmodel import Session, col, select

from app.db import SessionDep
from app.engine.categories import TRAVEL_BOOKING, parent_of
from app.models import Account, BalanceSnapshot, Category, Claim, Trip, Txn
from app.routers.claims import claim_view, outstanding_total
from app.routers.transactions import review_counts

router = APIRouter(tags=["summary"])

MONTH = func.strftime("%Y-%m", Txn.occurred_at)
GROUP_ORDER = ["여행", "취미", "생활", "고정비", "기타"]
HOBBIES = ["여행", "러닝", "카메라"]  # 여행 = spending on travel trips + bookings made ahead


def _month_add(ym: str, n: int) -> str:
    y, m = map(int, ym.split("-"))
    idx = y * 12 + (m - 1) + n
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def _categories(session: Session) -> dict[str, Category]:
    return {c.name: c for c in session.exec(select(Category)).all()}


def _spending_conds():
    return (Txn.kind == "expense", col(Txn.dup_of_id).is_(None))


def _range(start: date | None, end: date | None):
    conds = []
    if start:
        conds.append(Txn.occurred_at >= datetime.combine(start, datetime.min.time()))
    if end:
        conds.append(Txn.occurred_at < datetime.combine(end + timedelta(days=1), datetime.min.time()))
    return conds


@router.get("/summary/overview")
def overview(session: SessionDep, months: int = 13) -> dict:
    cats = _categories(session)
    first, last = session.exec(select(func.min(Txn.occurred_at), func.max(Txn.occurred_at))).one()
    if not last:
        return {"empty": True, "review": review_counts(session)}
    end_month = last.strftime("%Y-%m")
    month_keys = [_month_add(end_month, -i) for i in range(months - 1, -1, -1)]
    start_dt = datetime.strptime(month_keys[0] + "-01", "%Y-%m-%d")

    # Spending splits into daily life and trips/events (rows tagged with a trip): the two behave
    # very differently, so the home screen can show them apart.
    daily_flag = case((col(Txn.trip_id).is_(None), 1), else_=0)
    rows = session.exec(
        select(MONTH, Txn.kind, Txn.category, daily_flag, func.sum(Txn.amount), func.count())
        .where(Txn.occurred_at >= start_dt, col(Txn.dup_of_id).is_(None))
        .group_by(MONTH, Txn.kind, Txn.category, daily_flag)
    ).all()
    by_month: dict[str, dict] = {
        m: {"month": m, "spending": 0, "income": 0, "savings_in": 0, "card_payments": 0,
            "daily": 0, "trips": 0, "trip_names": {},
            "by_group": {g: 0 for g in GROUP_ORDER}, "by_category": defaultdict(int),
            "by_group_daily": {g: 0 for g in GROUP_ORDER}, "by_category_daily": defaultdict(int)}
        for m in month_keys
    }
    for m, kind, cat, daily, total, _n in rows:
        b = by_month.get(m)
        if not b:
            continue
        if kind == "expense":
            b["spending"] -= total
            b["by_category"][cat] -= total
            group = cats[cat].group if cat in cats else "기타"
            group = group if group in b["by_group"] else "기타"
            b["by_group"][group] -= total
            if daily:
                b["daily"] -= total
                b["by_category_daily"][cat] -= total
                b["by_group_daily"][group] -= total
            else:
                b["trips"] -= total
        elif kind == "income":
            b["income"] += total
        elif kind == "savings" and total > 0:
            b["savings_in"] += total
        elif kind == "card_payment":
            b["card_payments"] -= total
    for m, name, total in session.exec(
        select(MONTH, Trip.name, func.sum(Txn.amount))
        .join(Trip, Trip.id == Txn.trip_id)
        .where(*_spending_conds(), Txn.occurred_at >= start_dt)
        .group_by(MONTH, Trip.id)
    ).all():
        if m in by_month and total:
            by_month[m]["trip_names"][name] = -total
    for b in by_month.values():
        b["by_category"] = dict(b["by_category"])
        b["by_category_daily"] = dict(b["by_category_daily"])

    # Year to date and hobby totals
    year = last.year
    ytd_rows = session.exec(
        select(Txn.category, func.sum(Txn.amount), func.count())
        .where(*_spending_conds(), Txn.occurred_at >= datetime(year, 1, 1))
        .group_by(Txn.category)
    ).all()
    ytd = sorted(
        (
            {"category": c, "group": cats[c].group if c in cats else "기타",
             "color": cats[c].color if c in cats else "#999", "amount": -s, "count": n}
            for c, s, n in ytd_rows
        ),
        key=lambda r: -r["amount"],
    )
    ytd_daily = [
        {"category": c, "amount": -s, "count": n}
        for c, s, n in session.exec(
            select(Txn.category, func.sum(Txn.amount), func.count())
            .where(*_spending_conds(), col(Txn.trip_id).is_(None), Txn.occurred_at >= datetime(year, 1, 1))
            .group_by(Txn.category)
        ).all()
    ]
    last12_start = datetime.strptime(_month_add(end_month, -11) + "-01", "%Y-%m-%d")
    travel_trips = set(session.exec(select(Trip.id).where(Trip.kind == "travel")).all())

    def hobby_of(category: str, trip_id: int | None) -> str | None:
        if trip_id in travel_trips or (trip_id is None and category in TRAVEL_BOOKING):
            return "여행"
        p = parent_of(category)
        return p if p in HOBBIES else None

    last12: dict[str, int] = defaultdict(int)
    this_year: dict[str, int] = defaultdict(int)
    for category, trip_id, amount, at in session.exec(
        select(Txn.category, Txn.trip_id, Txn.amount, Txn.occurred_at)
        .where(*_spending_conds(), Txn.occurred_at >= min(last12_start, datetime(year, 1, 1)))
    ).all():
        h = hobby_of(category, trip_id)
        if not h:
            continue
        if at >= last12_start:
            last12[h] -= amount
        if at >= datetime(year, 1, 1):
            this_year[h] -= amount
    hobbies = [
        {"category": h, "color": cats[h].color if h in cats else "#2a78d6",
         "ytd": this_year.get(h, 0), "last12": last12.get(h, 0)}
        for h in HOBBIES
    ]

    # What MoneyLab corrected relative to Banksalad's own totals
    miscounted = session.exec(
        select(func.coalesce(func.sum(Txn.amount), 0), func.count())
        .where(Txn.kind == "card_payment", Txn.src_type == "지출")
    ).one()
    dups = session.exec(
        select(func.coalesce(func.sum(func.abs(Txn.amount)), 0), func.count())
        .where(col(Txn.dup_of_id).is_not(None))
    ).one()

    return {
        "empty": False,
        "range": {"first": first, "last": last},
        "months": [by_month[m] for m in month_keys],
        "year": year,
        "ytd": ytd,
        "ytd_daily": ytd_daily,
        "hobbies": hobbies,
        "review": review_counts(session),
        "corrected": {
            "card_payments_as_spending": {"amount": -miscounted[0], "count": miscounted[1]},
            "duplicates": {"amount": dups[0], "count": dups[1]},
        },
        "balances": balances(session),
        "claims_outstanding": _claims_outstanding(session),
    }


def _claims_outstanding(session: Session) -> int:
    from app.routers.claims import outstanding_total

    return outstanding_total(session)


def balances(session: Session) -> dict | None:
    as_of = session.exec(select(func.max(BalanceSnapshot.as_of))).one()
    if not as_of:
        return None
    rows = session.exec(select(BalanceSnapshot).where(BalanceSnapshot.as_of == as_of)).all()
    groups: dict[tuple[str, str], list] = defaultdict(list)
    for r in rows:
        if r.amount:
            groups[(r.side, r.group)].append({"name": r.name, "amount": r.amount})
    # Open 정산 and money lent: mine, just not in an account yet.
    for c in session.exec(select(Claim).where(Claim.status == "open")).all():
        if (owed := claim_view(session, c)["outstanding"]) > 0:
            groups[("asset", "받을 돈")].append({"name": c.name, "amount": owed})
    assets = sum(r.amount for r in rows if r.side == "asset") + sum(i["amount"] for i in groups.get(("asset", "받을 돈"), []))
    debts = sum(r.amount for r in rows if r.side == "debt")
    return {
        "as_of": as_of,
        "assets": assets,
        "debts": debts,
        "net": assets - debts,
        "groups": [
            {"side": side, "group": g, "amount": sum(i["amount"] for i in items),
             "items": sorted(items, key=lambda i: -i["amount"])}
            for (side, g), items in sorted(groups.items(), key=lambda kv: -sum(i["amount"] for i in kv[1]))
        ],
    }


@router.get("/summary/categories")
def by_category(session: SessionDep, start: date | None = None, end: date | None = None) -> list[dict]:
    cats = _categories(session)
    rows = session.exec(
        select(Txn.category, func.sum(Txn.amount), func.count())
        .where(*_spending_conds(), *_range(start, end))
        .group_by(Txn.category)
    ).all()
    out = [
        {"category": c, "group": cats[c].group if c in cats else "기타",
         "color": cats[c].color if c in cats else "#999", "amount": -s, "count": n}
        for c, s, n in rows
    ]
    return sorted(out, key=lambda r: -r["amount"])


@router.get("/summary/merchants")
def top_merchants(session: SessionDep, start: date | None = None, end: date | None = None,
                  category: str | None = None, limit: int = 15) -> list[dict]:
    conds = [*_spending_conds(), *_range(start, end)]
    if category:
        conds.append(Txn.category == category)
    rows = session.exec(
        select(Txn.merchant, func.sum(Txn.amount), func.count())
        .where(*conds).group_by(Txn.merchant).order_by(func.sum(Txn.amount)).limit(limit)
    ).all()
    return [{"merchant": m, "amount": -s, "count": n} for m, s, n in rows]


STALE_DAYS = 60


@router.get("/accounts")
def list_accounts(session: SessionDep) -> list[dict]:
    """Accounts with activity span; `stale` flags a connection that may have lapsed in Banksalad."""
    stats = {
        aid: (n, first, last)
        for aid, n, first, last in session.exec(
            select(Txn.account_id, func.count(), func.min(Txn.occurred_at), func.max(Txn.occurred_at))
            .where(Txn.provisional == False)
            .group_by(Txn.account_id)
        ).all()
    }
    newest = max((s[2] for s in stats.values()), default=None)
    out = []
    for a in session.exec(select(Account).order_by(Account.kind, Account.name)).all():
        n, first, last = stats.get(a.id, (0, None, None))
        gap = (newest - last).days if newest and last else None
        out.append({
            **a.model_dump(), "txn_count": n, "first_at": first, "last_at": last,
            "stale": bool(gap is not None and gap > STALE_DAYS and n >= 5),
            "days_since": gap,
        })
    return out


@router.get("/summary/networth")
def networth(session: SessionDep) -> list[dict]:
    """One point per export (재무현황 snapshot)."""
    rows = session.exec(select(BalanceSnapshot).order_by(BalanceSnapshot.as_of)).all()
    by_date: dict = defaultdict(lambda: {"assets": 0, "debts": 0, "groups": defaultdict(int)})
    for r in rows:
        d = by_date[r.as_of]
        if r.side == "asset":
            d["assets"] += r.amount
            d["groups"][r.group] += r.amount
        else:
            d["debts"] += r.amount
    # Money lent or owed back (open 정산) is mine too — counted on the latest point only, since
    # older snapshots can't say what was outstanding then.
    if by_date and (owed := outstanding_total(session)) > 0:
        last = by_date[max(by_date)]
        last["assets"] += owed
        last["groups"]["받을 돈"] += owed
    return [
        {"as_of": k, "assets": v["assets"], "debts": v["debts"], "net": v["assets"] - v["debts"],
         "groups": dict(v["groups"])}
        for k, v in sorted(by_date.items())
    ]


@router.get("/summary/cards")
def cards(session: SessionDep, months: int = 12) -> dict:
    """Card usage per month next to the bill payments leaving the bank, per issuer."""
    from app.engine.classify import infer_issuer

    last = session.exec(select(func.max(Txn.occurred_at))).one()
    if not last:
        return {"months": [], "issuers": []}
    end_month = last.strftime("%Y-%m")
    keys = [_month_add(end_month, -i) for i in range(months - 1, -1, -1)]
    start = datetime.strptime(keys[0] + "-01", "%Y-%m-%d")
    accounts = {a.id: a for a in session.exec(select(Account)).all()}

    usage: dict[str, dict[str, dict[str, int]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    for aid, m, total in session.exec(
        select(Txn.account_id, MONTH, func.sum(Txn.amount))
        .where(Txn.kind == "expense", col(Txn.dup_of_id).is_(None), Txn.occurred_at >= start)
        .group_by(Txn.account_id, MONTH)
    ).all():
        a = accounts[aid]
        if a.kind != "card":
            continue
        usage[a.issuer or "미지정"][a.label or a.name][m] -= total

    paid: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for merchant, m, total in session.exec(
        select(Txn.merchant, MONTH, func.sum(Txn.amount))
        .where(Txn.kind == "card_payment", Txn.occurred_at >= start)
        .group_by(Txn.merchant, MONTH)
    ).all():
        paid[infer_issuer(merchant) or "기타"][m] -= total

    issuers = []
    for issuer in sorted(set(usage) | set(paid)):
        cards_ = usage.get(issuer, {})
        issuers.append({
            "issuer": issuer,
            "cards": [
                {"name": name, "months": [per.get(k, 0) for k in keys]} for name, per in cards_.items()
            ],
            "used": [sum(per.get(k, 0) for per in cards_.values()) for k in keys],
            "paid": [paid.get(issuer, {}).get(k, 0) for k in keys],
        })
    return {"months": keys, "issuers": issuers}


@router.get("/categories")
def list_categories(session: SessionDep) -> list[Category]:
    return list(session.exec(select(Category).order_by(Category.sort)).all())
