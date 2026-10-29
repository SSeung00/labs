from datetime import date

from pydantic import NaiveDatetime
from sqlmodel import Field, SQLModel, UniqueConstraint

# Txn.kind — what the money movement *is*, independent of the spending category.
#   expense       spending (negative) or a refund of spending (positive)
#   income        salary, interest, …
#   transfer      between my accounts or to/from other people; not spending
#   card_payment  bank → card company bill payment (the card rows already count as spending)
#   savings       money landing in / leaving a savings account (청년도약계좌 등)
#   invest        money moving into / out of investing (증권 계좌 입출금)
#   claim         paid for someone else and to be paid back (학회비 등 정산), or that pay-back:
#                 neither spending nor income; tracked per Claim until settled
KINDS = ("expense", "income", "transfer", "card_payment", "savings", "invest", "claim")

# Account.kind
ACCOUNT_KINDS = ("bank", "card", "check_card", "pay", "savings", "invest", "cash", "other")

# Card issuers, for matching bank bill payments to card accounts and payment notifications.
ISSUERS = ("삼성", "현대", "신한", "KB국민", "롯데", "하나", "우리", "BC", "NH농협", "씨티", "카카오뱅크")

# Txn.source
SOURCES = ("banksalad", "file", "notify", "manual")


class Setting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str | None = None
    updated_at: NaiveDatetime | None = None


class Account(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)  # Banksalad's 결제수단 text, verbatim
    kind: str = "other"
    label: str | None = None  # optional display name
    hidden: bool = False
    issuer: str | None = None  # card company (cards only)
    # Bank account this one draws on (a 체크카드 debits the bank): its rows count in that
    # bank's balance checks.
    funding_account_id: int | None = None


class ImportBatch(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    source: str = "banksalad"
    filename: str
    sha256: str = Field(index=True)
    imported_at: NaiveDatetime
    period_start: date | None = None
    period_end: date | None = None
    rows_total: int = 0
    rows_new: int = 0
    rows_existing: int = 0
    rows_skipped: int = 0


class Txn(SQLModel, table=True):
    # Exports overlap and Banksalad has no row id: identical rows are told apart by their
    # occurrence number within one export (see ingest.banksalad.row_keys).
    __table_args__ = (UniqueConstraint("base_key", "occurrence"),)

    id: int | None = Field(default=None, primary_key=True)
    account_id: int = Field(foreign_key="account.id", index=True)
    occurred_at: NaiveDatetime = Field(index=True)
    amount: int  # KRW, signed: negative = money out
    currency: str = "KRW"
    merchant: str = ""

    # Banksalad's own labels, refreshed on every re-import.
    src_type: str = ""  # 지출 / 수입 / 이체
    src_cat: str = ""
    src_sub: str = ""
    src_memo: str | None = None

    base_key: str = Field(index=True)
    occurrence: int = 1
    batch_id: int | None = Field(default=None, foreign_key="importbatch.id")
    source: str = "banksalad"
    # Live payment notification not yet confirmed by an export. Superseded (dup_of_id set)
    # once the same payment arrives from Banksalad.
    provisional: bool = False

    # Our interpretation. *_locked = set by hand; the auto pipeline leaves it alone.
    kind: str = Field(default="expense", index=True)
    kind_locked: bool = False
    category: str = Field(default="미분류", index=True)
    category_locked: bool = False
    rule_id: int | None = None
    trip_id: int | None = Field(default=None, index=True)
    trip_locked: bool = False
    dup_of_id: int | None = Field(default=None, index=True)
    dup_locked: bool = False
    # What it was, in my words ("러닝화 1080 V15"): shown instead of the merchant when set.
    title: str | None = None
    note: str | None = None
    reviewed: bool = False

    # Claude's suggestion for uncategorised rows (shown, never applied automatically).
    ai_category: str | None = None
    ai_reason: str | None = None

    # Overseas payments: what was charged in the local currency (Banksalad only gives KRW).
    fx_currency: str | None = None
    fx_amount: float | None = None
    fee: int | None = None

    # A pay/check-card row that a bank statement showed leaving this bank account.
    funded_by: int | None = None
    # Part of a reimbursement claim (학회·연구비 정산).
    claim_id: int | None = Field(default=None, index=True)


class Rule(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = ""
    pattern: str  # case-insensitive regex on the merchant text
    account_kind: str | None = None  # only rows from this kind of account
    set_category: str | None = None
    set_kind: str | None = None
    priority: int = 100  # lower runs first; first matching rule wins
    enabled: bool = True
    builtin: bool = False
    created_at: NaiveDatetime | None = None


class Category(SQLModel, table=True):
    name: str = Field(primary_key=True)
    group: str  # 여행 / 취미 / 생활 / 고정비 / 기타 / 수입 (home chart buckets)
    color: str
    sort: int = 0
    parent: str | None = None  # 대분류 of a 소분류; None for a 대분류 (see engine.categories)


TRIP_KINDS = ("travel", "event")


class Trip(SQLModel, table=True):
    """A trip, or an event (학회·단체 행사) — an event's own spending stays out of the travel
    fund and daily budgets, and what I paid for others goes in its linked Claim."""

    id: int | None = Field(default=None, primary_key=True)
    name: str
    kind: str = "travel"  # travel | event
    start_date: date
    end_date: date
    budget: int | None = None
    note: str | None = None


class Goal(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    kind: str = "fund"  # fund (여행 기금 등) | savings (적금 상품)
    target_amount: int | None = None
    target_date: date | None = None
    start_date: date | None = None
    monthly_amount: int | None = None
    account_id: int | None = Field(default=None, foreign_key="account.id")  # balance source
    saved_manual: int | None = None  # used when no account is linked
    note: str | None = None
    sort: int = 0
    # 적금 maturity estimate inputs (all user-entered; product terms differ and change).
    rate: float | None = None  # annual %, base + 우대
    gov_monthly: int | None = None  # 정부기여금 per month, if any
    tax_free: bool = True


class BalanceSnapshot(SQLModel, table=True):
    """Asset/liability balances from the export's 재무현황 sheet, one set per export end date."""

    __table_args__ = (UniqueConstraint("as_of", "side", "group", "name"),)

    id: int | None = Field(default=None, primary_key=True)
    as_of: date = Field(index=True)
    side: str = "asset"  # asset | debt
    group: str = ""
    name: str
    amount: int


# ---------- budget & plan ----------

class BudgetLine(SQLModel, table=True):
    """One line of the monthly plan.

    spend   monthly limit for a set of categories (생활비, 고정비 …)
    fund    sinking fund / envelope: monthly contribution accumulates, spending in its
            categories (and trips, if include_trips) draws it down (여행, 러닝, 카메라 …)
    save    planned monthly saving into savings accounts (청년도약계좌)
    invest  planned monthly investing
    """

    id: int | None = Field(default=None, primary_key=True)
    name: str
    kind: str = "spend"
    categories: str = "[]"  # JSON list of category names
    include_trips: bool = False
    monthly_amount: int = 0
    start_month: str | None = None  # YYYY-MM, funds accumulate from here
    opening_balance: int = 0
    color: str | None = None
    sort: int = 0
    active: bool = True


class PlanEvent(SQLModel, table=True):
    """A one-off planned in/outflow in a future month (여행, 큰 구매, 성과급 …)."""

    id: int | None = Field(default=None, primary_key=True)
    month: str  # YYYY-MM
    name: str
    amount: int  # negative = spending, positive = extra income
    line_id: int | None = Field(default=None, foreign_key="budgetline.id")  # paid from this fund
    trip_id: int | None = Field(default=None, foreign_key="trip.id")
    note: str | None = None


# ---------- investing ----------

ASSET_CLASSES = ("국내주식", "해외주식", "채권", "현금성", "원자재", "부동산", "기타")


class Holding(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    account: str = ""  # 증권 계좌 이름 (자유 입력)
    name: str
    ticker: str | None = None
    asset_class: str = "기타"
    quantity: float | None = None
    cost: int = 0  # 투자 원금
    value: int = 0  # 평가 금액
    updated_at: NaiveDatetime | None = None
    source: str = "manual"  # manual | banksalad
    note: str | None = None


class HoldingSnapshot(SQLModel, table=True):
    """Total invested / valued at a point in time, for the growth chart."""

    id: int | None = Field(default=None, primary_key=True)
    as_of: date = Field(index=True, unique=True)
    cost: int
    value: int


# ---------- other importers & notifications ----------

class ImportTemplate(SQLModel, table=True):
    """Column mapping for a non-Banksalad file layout, recognised by its header row."""

    id: int | None = Field(default=None, primary_key=True)
    signature: str = Field(index=True, unique=True)
    name: str
    mapping: str  # JSON
    account_id: int | None = Field(default=None, foreign_key="account.id")


class NotifyLog(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    received_at: NaiveDatetime = Field(index=True)
    app: str = ""
    title: str = ""
    text: str = ""
    status: str = ""  # added | duplicate | ignored | error
    detail: str | None = None
    txn_id: int | None = None


# ---------- checks, reports, links ----------

class BalanceCheck(SQLModel, table=True):
    """A balance the user read off a real statement, to test the ledger for gaps."""

    id: int | None = Field(default=None, primary_key=True)
    account_id: int = Field(foreign_key="account.id", index=True)
    on_date: date  # balance at the end of this day
    amount: int
    note: str | None = None


class Report(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    month: str = Field(index=True)  # YYYY-MM
    created_at: NaiveDatetime
    model: str = ""
    markdown: str
    input_tokens: int = 0
    output_tokens: int = 0


class RunLink(SQLModel, table=True):
    """A running purchase tied to a RunLab shoe or goal race (RunLab ids)."""

    txn_id: int = Field(primary_key=True, foreign_key="txn.id")
    gear_id: int | None = None
    race_id: int | None = None


CLAIM_KINDS = ("reimburse", "loan")


class Claim(SQLModel, table=True):
    """Money that should come back to me.

    reimburse  paid on my card for the lab / a conference / friends (학회비, 단체 예약)
    loan       lent to someone (가족에게 빌려준 돈): an asset until repaid, no expected date needed
    """

    id: int | None = Field(default=None, primary_key=True)
    name: str
    kind: str = "reimburse"
    trip_id: int | None = Field(default=None, foreign_key="trip.id")  # the event it belongs to
    status: str = "open"  # open | closed
    expected_date: date | None = None  # when the reimbursement should arrive (for the cash plan)
    note: str | None = None
    created_at: NaiveDatetime | None = None
    closed_at: NaiveDatetime | None = None
