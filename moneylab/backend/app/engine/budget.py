"""Monthly budget, sinking funds and the 12-month cash plan.

Model (see BudgetLine):
- spend lines cap a set of categories per month.
- fund lines ("봉투") accrue a monthly contribution and are drawn down by spending in their
  categories — and by trip spending when include_trips — so lumpy costs (여행, 카메라) are
  smoothed into a monthly number.
- save / invest lines are planned transfers; for these, `categories` holds account ids
  (empty = every savings / investing account).

Every spending row counts toward exactly one line: a trip row goes to the first trip fund,
otherwise to the first line listing its category, otherwise it is "예산 밖". Rows of an event
(학회·단체 행사) go to a line listing "학회·행사" if there is one, else they stay 예산 밖 under
that name: they're real spending, but not something a daily budget should absorb.
"""

import json
import math
from calendar import monthrange
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from statistics import median

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.engine.categories import TRAVEL_BOOKING, parent_of
from app.models import (
    Account,
    BalanceSnapshot,
    BudgetLine,
    Category,
    Claim,
    PlanEvent,
    Setting,
    Trip,
    Txn,
)

LIQUID_GROUP_HINTS = ("입출금", "전자금융", "현금")


# ---------- months ----------

def ym(d: date | datetime) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def add_months(month: str, n: int) -> str:
    y, m = map(int, month.split("-"))
    idx = y * 12 + (m - 1) + n
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def months_between(a: str, b: str) -> int:
    """b - a in months."""
    ay, am = map(int, a.split("-"))
    by, bm = map(int, b.split("-"))
    return (by - ay) * 12 + (bm - am)


def month_start(month: str) -> datetime:
    y, m = map(int, month.split("-"))
    return datetime(y, m, 1)


def month_end(month: str) -> datetime:
    return month_start(add_months(month, 1))


def round_up(v: float, unit: int = 10_000) -> int:
    return int(math.ceil(max(0, v) / unit) * unit)


# ---------- settings ----------

def get_setting(session: Session, key: str, default: str | None = None) -> str | None:
    row = session.get(Setting, key)
    return row.value if row and row.value is not None else default


def put_setting(session: Session, key: str, value: str | None) -> None:
    row = session.get(Setting, key) or Setting(key=key)
    row.value = value
    row.updated_at = datetime.now()
    session.add(row)


def plan_settings(session: Session) -> dict:
    return {
        "income": int(get_setting(session, "plan.income", "0") or 0),
        "emergency_months": float(get_setting(session, "plan.emergency_months", "3") or 3),
    }


# ---------- line assignment ----------

def line_categories(line: BudgetLine) -> list:
    try:
        v = json.loads(line.categories or "[]")
        return v if isinstance(v, list) else []
    except json.JSONDecodeError:
        return []


def active_lines(session: Session) -> list[BudgetLine]:
    return list(
        session.exec(
            select(BudgetLine).where(BudgetLine.active == True).order_by(BudgetLine.sort, BudgetLine.id)
        ).all()
    )


EVENT_CATEGORY = "학회·행사"


def event_ids(session: Session) -> frozenset[int]:
    return frozenset(session.exec(select(Trip.id).where(Trip.kind == "event")).all())


@dataclass
class Assigner:
    trip_fund: int | None
    by_category: dict[str, int] = field(default_factory=dict)
    events: frozenset[int] = frozenset()

    @classmethod
    def build(cls, lines: list[BudgetLine], events: frozenset[int] = frozenset()) -> "Assigner":
        trip_fund = next((ln.id for ln in lines if ln.kind == "fund" and ln.include_trips), None)
        by_cat: dict[str, int] = {}
        for ln in lines:
            if ln.kind not in ("spend", "fund"):
                continue
            for c in line_categories(ln):
                by_cat.setdefault(str(c), ln.id)
        return cls(trip_fund, by_cat, events)

    def bucket(self, category: str, trip_id: int | None) -> str:
        """The category a row is budgeted as: an event's rows all count as 학회·행사."""
        return EVENT_CATEGORY if trip_id in self.events else category

    def line_for(self, category: str, trip_id: int | None) -> int | None:
        if trip_id in self.events:
            return self.by_category.get(EVENT_CATEGORY)
        if trip_id and self.trip_fund:
            return self.trip_fund
        # A line can list a 소분류 (카페·간식) or a whole 대분류 (식비).
        return self.by_category.get(category) or self.by_category.get(parent_of(category))


def spending_rows(session: Session, start: datetime, end: datetime):
    return session.exec(
        select(Txn.category, Txn.trip_id, Txn.amount, Txn.occurred_at).where(
            Txn.kind == "expense", col(Txn.dup_of_id).is_(None),
            Txn.occurred_at >= start, Txn.occurred_at < end,
        )
    ).all()


def savings_by_account(session: Session, start: datetime, end: datetime) -> dict[int, int]:
    rows = session.exec(
        select(Txn.account_id, func.sum(Txn.amount)).where(
            Txn.kind == "savings", Txn.amount > 0, col(Txn.dup_of_id).is_(None),
            Txn.occurred_at >= start, Txn.occurred_at < end,
        ).group_by(Txn.account_id)
    ).all()
    return dict(rows)


def invest_by_account(session: Session, start: datetime, end: datetime) -> dict[int, int]:
    """Net money put into investing, per account it was booked on."""
    kinds = {a.id: a.kind for a in session.exec(select(Account)).all()}
    rows = session.exec(
        select(Txn.account_id, Txn.amount).where(
            Txn.kind == "invest", col(Txn.dup_of_id).is_(None),
            Txn.occurred_at >= start, Txn.occurred_at < end,
        )
    ).all()
    out: dict[int, int] = defaultdict(int)
    for acc, amount in rows:
        out[acc] += amount if kinds.get(acc) == "invest" else -amount
    return dict(out)


def _transfer_actual(line: BudgetLine, by_account: dict[int, int]) -> int:
    ids = {int(x) for x in line_categories(line) if str(x).isdigit()}
    return sum(v for k, v in by_account.items() if not ids or k in ids)


# ---------- month view ----------

def month_view(session: Session, month: str, today: date | None = None) -> dict:
    today = today or date.today()
    lines = active_lines(session)
    assigner = Assigner.build(lines, event_ids(session))
    start, end = month_start(month), month_end(month)
    cats = {c.name: c for c in session.exec(select(Category)).all()}

    spent: dict[int | None, int] = defaultdict(int)
    unbudgeted: dict[str, int] = defaultdict(int)
    for category, trip_id, amount, _ in spending_rows(session, start, end):
        lid = assigner.line_for(category, trip_id)
        spent[lid] -= amount
        if lid is None:
            unbudgeted[assigner.bucket(category, trip_id)] -= amount

    savings = savings_by_account(session, start, end)
    invest = invest_by_account(session, start, end)
    income = session.exec(
        select(func.coalesce(func.sum(Txn.amount), 0)).where(
            Txn.kind == "income", col(Txn.dup_of_id).is_(None),
            Txn.occurred_at >= start, Txn.occurred_at < end,
        )
    ).one()

    days = monthrange(start.year, start.month)[1]
    if ym(today) == month:
        pace = today.day / days
    elif month < ym(today):
        pace = 1.0
    else:
        pace = 0.0

    out_lines = []
    for ln in lines:
        item = {
            "id": ln.id, "name": ln.name, "kind": ln.kind, "color": ln.color,
            "categories": line_categories(ln), "include_trips": ln.include_trips,
            "planned": ln.monthly_amount,
        }
        if ln.kind in ("spend", "fund"):
            item["actual"] = spent.get(ln.id, 0)
        elif ln.kind == "save":
            item["actual"] = _transfer_actual(ln, savings)
        else:
            item["actual"] = _transfer_actual(ln, invest)
        if ln.kind == "fund":
            item["balance"] = fund_balance(session, ln, month, assigner)
        out_lines.append(item)

    plan = plan_settings(session)
    spend_planned = sum(ln.monthly_amount for ln in lines if ln.kind in ("spend", "fund"))
    total_spent = sum(v for v in spent.values())
    return {
        "month": month,
        "pace": pace,
        "income": {"planned": plan["income"], "actual": income},
        "lines": out_lines,
        "unbudgeted": sorted(
            (
                {"category": c, "amount": a, "color": cats[c].color if c in cats else "#999"}
                for c, a in unbudgeted.items() if a
            ),
            key=lambda r: -r["amount"],
        ),
        "totals": {
            "spend_planned": spend_planned,
            "spent": total_spent,
            "save_planned": sum(ln.monthly_amount for ln in lines if ln.kind == "save"),
            "invest_planned": sum(ln.monthly_amount for ln in lines if ln.kind == "invest"),
        },
    }


def fund_balance(session: Session, line: BudgetLine, through: str,
                 assigner: Assigner | None = None) -> int:
    """Opening + contributions − spending, from start_month through `through` (inclusive)."""
    start_m = line.start_month or through
    if through < start_m:
        return line.opening_balance
    assigner = assigner or Assigner.build(active_lines(session), event_ids(session))
    n = months_between(start_m, through) + 1
    used = 0
    for category, trip_id, amount, _ in spending_rows(session, month_start(start_m), month_end(through)):
        if assigner.line_for(category, trip_id) == line.id:
            used -= amount
    return line.opening_balance + line.monthly_amount * n - used


# ---------- 12-month plan ----------

def liquid_cash(session: Session) -> tuple[int | None, date | None]:
    as_of = session.exec(select(func.max(BalanceSnapshot.as_of))).one()
    if not as_of:
        return None, None
    rows = session.exec(
        select(BalanceSnapshot).where(BalanceSnapshot.as_of == as_of, BalanceSnapshot.side == "asset")
    ).all()
    total = sum(r.amount for r in rows if any(h in r.group for h in LIQUID_GROUP_HINTS))
    return total, as_of


def forecast(session: Session, months: int = 12, today: date | None = None) -> dict:
    today = today or date.today()
    current = ym(today)
    plan = plan_settings(session)
    lines = active_lines(session)
    assigner = Assigner.build(lines, event_ids(session))
    events = list(session.exec(select(PlanEvent).where(PlanEvent.month >= current)).all())
    # Upcoming trips with a budget count as planned spending unless an event already covers them.
    covered = {e.trip_id for e in events if e.trip_id}
    for t in session.exec(select(Trip).where(Trip.end_date >= today)).all():
        if t.id in covered or not t.budget:
            continue
        spent = -session.exec(
            select(func.coalesce(func.sum(Txn.amount), 0)).where(
                Txn.trip_id == t.id, Txn.kind == "expense", col(Txn.dup_of_id).is_(None)
            )
        ).one()
        left = t.budget - spent
        if left > 0:
            events.append(PlanEvent(
                id=None, month=max(current, ym(t.start_date)), name=f"✈ {t.name}", amount=-left,
                line_id=assigner.line_for("여행", t.id), trip_id=t.id,
            ))
    # Money I'm owed (정산) comes back in the month it's expected (or next month). A loan
    # only counts once a repayment date is agreed: until then it isn't cash to plan with.
    for c in session.exec(select(Claim).where(Claim.status == "open")).all():
        if c.kind == "loan" and not c.expected_date:
            continue
        rows = session.exec(select(Txn.amount).where(Txn.claim_id == c.id, col(Txn.dup_of_id).is_(None))).all()
        owed = -sum(rows)
        if owed > 0:
            when = ym(c.expected_date) if c.expected_date else add_months(current, 1)
            events.append(PlanEvent(id=None, month=max(current, when), name=f"↩ {c.name} 정산", amount=owed))
    events_by_month: dict[str, list[PlanEvent]] = defaultdict(list)
    for e in events:
        events_by_month[e.month].append(e)

    cash, cash_as_of = liquid_cash(session)
    cash_known = cash is not None
    cash = cash or 0
    start_cash = cash

    spend_lines = [ln for ln in lines if ln.kind == "spend"]
    fund_lines = [ln for ln in lines if ln.kind == "fund"]
    xfer_lines = [ln for ln in lines if ln.kind in ("save", "invest")]
    monthly_spend = sum(ln.monthly_amount for ln in spend_lines)
    emergency = round(plan["emergency_months"] * monthly_spend)

    # This month is partly done; the snapshot already reflects what happened so far.
    now = month_view(session, current, today)
    actual = {ln["id"]: ln["actual"] for ln in now["lines"]}
    funds = {ln.id: fund_balance(session, ln, add_months(current, -1), assigner) for ln in fund_lines}

    rows = []
    warnings = []
    for i in range(months):
        m = add_months(current, i)
        first = i == 0
        income = plan["income"]
        if first:
            income = max(0, plan["income"] - now["income"]["actual"])
        spend = sum(
            max(0, ln.monthly_amount - actual.get(ln.id, 0)) if first else ln.monthly_amount
            for ln in spend_lines
        )
        xfer = sum(
            max(0, ln.monthly_amount - actual.get(ln.id, 0)) if first else ln.monthly_amount
            for ln in xfer_lines
        )
        extra_in = sum(e.amount for e in events_by_month.get(m, []) if e.amount > 0)
        event_out = sum(-e.amount for e in events_by_month.get(m, []) if e.amount < 0)

        for ln in fund_lines:
            funds[ln.id] += ln.monthly_amount
            if first:  # spending already happened this month comes out of the fund too
                funds[ln.id] -= actual.get(ln.id, 0)
        for e in events_by_month.get(m, []):
            if e.amount < 0 and e.line_id in funds:
                funds[e.line_id] += e.amount
                if funds[e.line_id] < 0:
                    name = next(ln.name for ln in fund_lines if ln.id == e.line_id)
                    warnings.append({
                        "month": m, "kind": "fund_short",
                        "message": f"{e.name}: '{name}' 봉투가 {-funds[e.line_id]:,}원 모자라요",
                    })

        cash = cash + income + extra_in - spend - xfer - event_out
        reserved = sum(max(0, v) for v in funds.values())
        free = cash - reserved - emergency
        if cash < 0:
            warnings.append({"month": m, "kind": "cash_negative", "message": "통장 잔액이 마이너스가 돼요"})
        rows.append({
            "month": m,
            "income": income + extra_in,
            "spend": spend,
            "transfers": xfer,
            "events": [
                {"id": e.id, "name": e.name, "amount": e.amount, "line_id": e.line_id, "trip_id": e.trip_id}
                for e in events_by_month.get(m, [])
            ],
            "event_out": event_out,
            "cash": cash,
            "reserved": reserved,
            "emergency": emergency,
            "free": free,
            "funds": dict(funds),
        })

    committed = sum(ln.monthly_amount for ln in lines)
    monthly_balance = plan["income"] - committed
    if lines and monthly_balance < 0:
        warnings.insert(0, {
            "month": current, "kind": "plan_deficit",
            "message": f"매달 계획(한도·봉투·저축·투자 {committed:,}원)이 수입보다 {-monthly_balance:,}원 많아요",
        })
    return {
        "monthly_balance": monthly_balance,
        "committed": committed,
        "start_cash": start_cash if cash_known else None,
        "cash_as_of": cash_as_of,
        "cash_known": cash_known,
        "settings": plan,
        "emergency_target": emergency,
        "months": rows,
        "funds": [{"id": ln.id, "name": ln.name, "color": ln.color} for ln in fund_lines],
        "warnings": warnings[:20],
    }


# ---------- draft from history ----------

def _monthly_totals(rows, months: list[str], key) -> dict[str, list[int]]:
    """{bucket: [total per month]} for spending rows bucketed by key(category, trip_id)."""
    acc: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for category, trip_id, amount, occurred_at in rows:
        b = key(category, trip_id)
        if b:
            acc[b][ym(occurred_at)] -= amount
    return {b: [per.get(m, 0) for m in months] for b, per in acc.items()}


def suggest_plan(session: Session, today: date | None = None) -> dict:
    today = today or date.today()
    current = ym(today)
    last6 = [add_months(current, -i) for i in range(6, 0, -1)]
    last12 = [add_months(current, -i) for i in range(12, 0, -1)]
    cats = {c.name: c for c in session.exec(select(Category)).all()}
    groups: dict[str, list[str]] = defaultdict(list)
    for c in cats.values():
        groups[c.group].append(c.name)

    rows = spending_rows(session, month_start(last12[0]), month_start(current))

    events = event_ids(session)

    def bucket(category: str, trip_id: int | None) -> str | None:
        if trip_id in events or category == EVENT_CATEGORY:
            return None  # one-off events aren't a monthly habit to budget for
        if trip_id or category in TRAVEL_BOOKING:
            return "여행"
        if parent_of(category) in ("러닝", "카메라"):
            return parent_of(category)
        g = cats[category].group if category in cats else "기타"
        return "고정비" if g == "고정비" else "생활비"

    per6 = _monthly_totals([r for r in rows if ym(r[3]) in last6], last6, bucket)
    per12 = _monthly_totals(rows, last12, bucket)

    income_rows = session.exec(
        select(Txn.amount, Txn.occurred_at).where(
            Txn.kind == "income", col(Txn.dup_of_id).is_(None),
            Txn.occurred_at >= month_start(last6[0]), Txn.occurred_at < month_start(current),
        )
    ).all()
    income_by_month = defaultdict(int)
    for amount, at in income_rows:
        income_by_month[ym(at)] += amount
    income = int(median([income_by_month.get(m, 0) for m in last6]) // 10_000 * 10_000)

    def med6(b: str) -> int:
        return round_up(median(per6.get(b, [0] * 6)))

    def avg12(b: str) -> int:
        return round_up(sum(per12.get(b, [0])) / 12)

    lines = [
        {
            "name": "생활비", "kind": "spend", "monthly_amount": med6("생활비"),
            "categories": sorted(groups["생활"] + groups["기타"], key=lambda n: cats[n].sort),
            "color": "#2f9e44", "basis": "최근 6개월 중앙값",
        },
        {
            "name": "고정비", "kind": "spend", "monthly_amount": med6("고정비"),
            "categories": sorted(groups["고정비"], key=lambda n: cats[n].sort),
            "color": "#868e96", "basis": "최근 6개월 중앙값",
        },
        {
            "name": "여행 봉투", "kind": "fund", "monthly_amount": avg12("여행"),
            "categories": sorted(TRAVEL_BOOKING), "include_trips": True, "color": "#2a78d6",
            "basis": "최근 12개월 여행 지출 ÷ 12",
        },
        {
            "name": "러닝 봉투", "kind": "fund", "monthly_amount": avg12("러닝"),
            "categories": ["러닝"], "color": "#e8590c", "basis": "최근 12개월 러닝 지출 ÷ 12",
        },
        {
            "name": "카메라 봉투", "kind": "fund", "monthly_amount": avg12("카메라"),
            "categories": ["카메라"], "color": "#9c36b5", "basis": "최근 12개월 카메라 지출 ÷ 12",
        },
    ]

    last3 = [add_months(current, -i) for i in range(3, 0, -1)]
    deposits = [savings_by_account(session, month_start(m), month_end(m)) for m in last3]
    for a in session.exec(select(Account).where(Account.kind == "savings")).all():
        amounts = [d.get(a.id, 0) for d in deposits]
        if any(amounts):
            lines.append({
                "name": a.label or a.name, "kind": "save", "monthly_amount": int(median(amounts)),
                "categories": [a.id], "color": "#0ca678", "basis": "최근 3개월 입금 중앙값",
            })
    lines.append({
        "name": "투자", "kind": "invest", "monthly_amount": 0, "categories": [],
        "color": "#7048e8", "basis": "직접 정해 주세요",
    })

    total_out = sum(ln["monthly_amount"] for ln in lines)
    return {
        "income": income,
        "income_basis": "최근 6개월 수입 중앙값",
        "lines": lines,
        "surplus": income - total_out,
        "months": {"last6": last6, "last12": last12},
    }


def apply_plan(session: Session, draft: dict, start_month: str) -> None:
    for ln in session.exec(select(BudgetLine)).all():
        session.delete(ln)
    for i, ln in enumerate(draft["lines"]):
        session.add(
            BudgetLine(
                name=ln["name"], kind=ln["kind"],
                categories=json.dumps(ln.get("categories", []), ensure_ascii=False),
                include_trips=bool(ln.get("include_trips")), monthly_amount=int(ln["monthly_amount"]),
                start_month=start_month if ln["kind"] == "fund" else None,
                opening_balance=int(ln.get("opening_balance", 0)), color=ln.get("color"), sort=i,
            )
        )
    put_setting(session, "plan.income", str(int(draft["income"])))
    session.commit()
