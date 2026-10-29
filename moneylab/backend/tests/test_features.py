import json
from datetime import date, datetime
from types import SimpleNamespace

from sqlmodel import Session, select

from app.db import engine
from app.engine import ai, budget, notify
from app.ingest import generic
from app.models import Account, BudgetLine, Txn
from tests.conftest import make_export, upload

BANK = "신한 주거래 우대통장(저축예금)"
CARD = "삼성카드 & MILEAGE PLATINUM (스카이패스)"
SAVE = "신한 청년도약계좌"


# ---------- budget & plan ----------

def _seed_budget(client):
    rows = [
        ("2026-09-03", "12:00:00", "지출", "식비", "한식", "김밥천국", -300000, CARD),
        ("2026-09-04", "12:00:00", "지출", "온라인쇼핑", "인터넷쇼핑", "가민", -500000, CARD),
        ("2026-09-05", "12:00:00", "지출", "여행/숙박", "항공권", "대한항공", -1000000, CARD),
        ("2026-09-06", "12:00:00", "지출", "식비", "일식", "이치란", -20000, CARD),
        ("2026-09-07", "12:00:00", "지출", "생활", "편의점", "기념품샵", -999, CARD),
        ("2026-09-01", "08:00:00", "이체", "내계좌이체", "미분류", "홍길동", 700000, SAVE),
        ("2026-09-20", "08:00:00", "수입", "급여", "미분류", "급여", 2000000, BANK),
    ]
    upload(client, make_export(rows, balances=[("자유입출금 자산", BANK, 3_000_000)]),
           "2026-09-01~2026-09-30.xlsx")
    client.post("/api/trips", json={"name": "도쿄", "start_date": "2026-09-06", "end_date": "2026-09-08"})
    with Session(engine) as s:
        save_id = s.exec(select(Account).where(Account.name == SAVE)).one().id
    lines = [
        {"name": "생활비", "kind": "spend", "categories": ["식비", "생활"], "monthly_amount": 400000},
        {"name": "여행 봉투", "kind": "fund", "categories": ["여행"], "include_trips": True,
         "monthly_amount": 200000, "start_month": "2026-01"},
        {"name": "러닝 봉투", "kind": "fund", "categories": ["러닝"], "monthly_amount": 100000,
         "start_month": "2026-09", "opening_balance": 300000},
        {"name": "청년도약", "kind": "save", "categories": [save_id], "monthly_amount": 700000},
    ]
    ids = [client.post("/api/budget/lines", json=ln).json()["id"] for ln in lines]
    client.put("/api/budget/settings", json={"income": 2_000_000, "emergency_months": 3})
    return ids


def test_month_budget_assigns_each_row_to_one_line(client):
    living, travel, running, save = _seed_budget(client)
    v = client.get("/api/budget", params={"month": "2026-09"}).json()
    lines = {ln["id"]: ln for ln in v["lines"]}
    # 이치란 and the souvenir are inside the trip window → travel fund, not 생활비.
    assert lines[living]["actual"] == 300000
    assert lines[travel]["actual"] == 1_000_000 + 20000 + 999
    assert lines[running]["actual"] == 500000
    assert lines[save]["actual"] == 700000
    # 9 months of 20만 contributions minus the trip.
    assert lines[travel]["balance"] == 9 * 200000 - 1_020_999
    assert lines[running]["balance"] == 300000 + 100000 - 500000
    assert v["unbudgeted"] == []


def test_forecast_runs_cash_and_reserves(client):
    _, travel, *_ = _seed_budget(client)
    client.post("/api/plan/events", json={"month": "2026-12", "name": "오사카", "amount": -1_500_000,
                                          "line_id": travel})
    f = budget.forecast(Session(engine), months=4, today=date(2026, 10, 1))
    assert f["start_cash"] == 3_000_000
    oct_, nov, dec, _ = f["months"]
    assert oct_["spend"] == 400000 and oct_["transfers"] == 700000
    assert nov["cash"] == 3_000_000 + 2 * (2_000_000 - 400000 - 700000)
    assert dec["event_out"] == 1_500_000
    assert any(w["kind"] == "fund_short" for w in f["warnings"])  # travel fund was spent down
    assert f["emergency_target"] == 3 * 400000


def test_draft_plan_from_history(client):
    _seed_budget(client)
    d = budget.suggest_plan(Session(engine), today=date(2026, 10, 9))
    names = [ln["name"] for ln in d["lines"]]
    assert {"생활비", "고정비", "여행 봉투", "러닝 봉투"} <= set(names)
    save = next(ln for ln in d["lines"] if ln["kind"] == "save")
    assert save["monthly_amount"] == 0 or save["monthly_amount"] == 700000
    assert d["income"] >= 0


# ---------- notifications ----------

NOW = datetime(2026, 10, 9, 21, 0)


def test_notify_parse_formats():
    p = notify.parse("삼성카드", "삼성카드 승인", "삼성1234 승인 이*호 12,500원 일시불 10/09 12:34 스타벅스코리아 누적1,234,000원", NOW)
    assert p.amount == -12500 and p.issuer == "삼성" and p.merchant == "스타벅스코리아"
    assert p.occurred_at == datetime(2026, 10, 9, 12, 34)

    p = notify.parse("현대카드", "현대카드", "[현대카드]승인 이*호 59,000원(3개월) 10/08 19:02 나이키코리아", NOW)
    assert p.amount == -59000 and p.issuer == "현대" and "나이키" in p.merchant and p.installment == 3

    p = notify.parse("삼성카드", "승인취소", "삼성카드 이*호 12,500원 승인취소 10/09 13:00 스타벅스코리아", NOW)
    assert p.amount == 12500 and p.cancelled

    p = notify.parse("com.kakaopay.app", "결제 완료", "카카오페이로 4,500원 결제했어요. GS25 역삼점", NOW)
    assert p.amount == -4500 and p.issuer == "카카오페이"

    assert notify.parse("삼성카드", "이벤트 안내", "10월 혜택을 확인하세요", NOW) is None
    assert notify.parse("현대카드", "명세서", "10월 결제예정금액 1,234,000원", NOW) is None


def test_notify_webhook_adds_provisional_then_export_confirms(client):
    upload(client, make_export([("2026-09-01", "10:00:00", "지출", "식비", "한식", "김밥", -5000, CARD)]),
           "2026-09-01~2026-09-30.xlsx")
    status = client.get("/api/hooks/notify/status").json()
    bad = client.post("/api/hooks/notify", json={"app": "삼성카드", "text": "x"}, headers={"X-MoneyLab-Token": "nope"})
    assert bad.status_code == 401

    body = {"app": "삼성카드", "title": "삼성카드 승인", "text": "이*호 8,900원 일시불 10/05 12:00 스타벅스"}
    r = client.post(f"/api/hooks/notify?token={status['token']}", json=body).json()
    assert r["status"] == "added"
    again = client.post("/api/hooks/notify", json=body, headers={"X-MoneyLab-Token": status["token"]}).json()
    assert again["status"] == "duplicate"
    live = client.get("/api/transactions", params={"view": "live"}).json()
    assert live["total"] == 1 and live["items"][0]["provisional"]

    # The monthly export brings the same payment: the live row steps aside.
    upload(client, make_export([("2026-10-05", "12:00:12", "지출", "카페/간식", "커피/음료", "스타벅스코리아", -8900, CARD)]),
           "2026-10-01~2026-10-09.xlsx")
    assert client.get("/api/transactions", params={"view": "live"}).json()["total"] == 0
    oct_ = client.get("/api/transactions", params={"start": "2026-10-01", "end": "2026-10-31"}).json()
    assert oct_["spending"] == 8900


# ---------- other bank / card files ----------

def test_generic_card_csv_backfills_before_banksalad(client):
    upload(client, make_export([("2025-01-10", "10:00:00", "지출", "식비", "한식", "김밥", -5000, CARD)]),
           "2025-01-01~2025-01-31.xlsx")
    csv_text = (
        "삼성카드 이용내역\n\n"
        "이용일,이용시간,가맹점명,이용금액,할부,비고\n"
        "2024.12.20,13:05,교보문고,22000,일시불,\n"
        "2024.12.21,09:00,스타벅스,5000,일시불,승인취소\n"
        "2025.01.10,10:00,김밥,5000,일시불,\n"
    ).encode("cp949")
    files = {"file": ("samsung.csv", csv_text, "text/csv")}
    prev = client.post("/api/imports/file/preview", files=files).json()
    m = prev["mapping"]
    assert prev["header"][m["date"]] == "이용일" and prev["header"][m["merchant"]] == "가맹점명"
    assert m["sign"] == "expense_positive"

    with Session(engine) as s:
        card_id = s.exec(select(Account).where(Account.name == CARD)).one().id
    r = client.post("/api/imports/file/commit", files=files, data={
        "mapping": json.dumps(m), "account_id": str(card_id), "cutoff": "2025-01-01",
        "save_template": "삼성카드 CSV",
    }).json()
    assert r["rows_new"] == 2 and r["after_cutoff"] == 1
    dec = client.get("/api/transactions", params={"start": "2024-12-01", "end": "2024-12-31"}).json()
    amounts = sorted(t["amount"] for t in dec["items"])
    assert amounts == [-22000, 5000]  # the cancellation refunds
    # Same layout next time: the template is recognised.
    assert client.post("/api/imports/file/preview", files=files).json()["template"]["name"] == "삼성카드 CSV"


def test_generic_bank_in_out_columns():
    table = [
        ["신한은행 거래내역조회"],
        ["거래일자", "거래시간", "적요", "출금(원)", "입금(원)", "내용", "잔액(원)"],
        ["2024-11-02", "09:10:11", "체크", "4,500", "", "GS25", "100,000"],
        ["2024-11-25", "05:00:00", "급여", "", "2,000,000", "연구비급여", "2,100,000"],
    ]
    h = generic.find_header(table)
    m = generic.guess_mapping(table[h])
    assert h == 1 and m["out"] == 3 and m["in"] == 4
    parsed = generic.parse_rows(table, h, m, "bank", "bank")
    assert [r.amount for r in parsed.rows] == [-4500, 2_000_000]
    assert parsed.rows[1].src_type == "수입"


def test_html_disguised_xls():
    html = "<html><table><tr><td>거래일시</td><td>적요</td><td>출금</td><td>입금</td></tr>" \
           "<tr><td>2024.10.01 10:00</td><td>편의점</td><td>3,000</td><td></td></tr></table></html>"
    table = generic.read_table(html.encode("cp949"), "x.xls")
    h = generic.find_header(table)
    parsed = generic.parse_rows(table, h, generic.guess_mapping(table[h]), "a", "bank")
    assert parsed.rows[0].amount == -3000 and parsed.rows[0].occurred_at.hour == 10


# ---------- investing ----------

def test_bank_to_brokerage_counts_once(client):
    rows = [
        ("2026-09-02", "10:00:00", "이체", "이체", "미분류", "키움증권", -300000, BANK),
        ("2026-09-02", "10:00:30", "이체", "이체", "미분류", "입금", 300000, "키움 위탁종합"),
        ("2026-09-15", "10:00:00", "이체", "이체", "미분류", "토스증권", -100000, BANK),
    ]
    upload(client, make_export(rows), "2026-09-01~2026-09-30.xlsx")
    inv = client.get("/api/invest").json()
    sep = next(c for c in inv["contributions"] if c["month"] == "2026-09")
    assert sep["amount"] == 400000  # 30만 (paired, counted on the brokerage side) + 10만


def test_holdings_and_targets(client):
    client.post("/api/invest/holdings", json={"name": "S&P500 ETF", "asset_class": "해외주식", "cost": 900000, "value": 1000000})
    client.post("/api/invest/holdings", json={"name": "CMA", "asset_class": "현금성", "cost": 1000000, "value": 1000000})
    assert client.put("/api/invest/targets", json={"targets": {"해외주식": 70, "현금성": 40}}).status_code == 400
    client.put("/api/invest/targets", json={"targets": {"해외주식": 60, "현금성": 40}})
    inv = client.get("/api/invest").json()
    assert inv["totals"]["gain"] == 100000
    by = {c["asset_class"]: c for c in inv["classes"]}
    assert by["해외주식"]["diff"] == 200000 and by["현금성"]["diff"] == -200000
    assert inv["snapshots"][-1]["value"] == 2_000_000


# ---------- AI suggestions ----------

class FakeClient:
    def __init__(self, answer):
        self.answer = answer
        self.sent = None
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kw):
        self.sent = kw
        return SimpleNamespace(
            stop_reason="end_turn", model="fake",
            content=[SimpleNamespace(type="text", text=json.dumps(self.answer, ensure_ascii=False))],
        )


def test_ai_suggestions_are_stored_not_applied(client):
    rows = [
        ("2026-09-02", "10:00:00", "지출", "온라인쇼핑", "결제/충전", "(주)케이지이니시스", -150000, CARD),
        ("2026-09-03", "10:00:00", "지출", "금융", "카드", "포토마루", -890000, CARD),
    ]
    upload(client, make_export(rows), "2026-09-01~2026-09-30.xlsx")
    with Session(engine) as s:
        cands = ai.candidates(s)
        keys = {t.merchant: i for i, t in enumerate(sorted(cands, key=lambda t: -t.occurred_at.timestamp()))}
        fake = FakeClient({"items": [
            {"key": keys["포토마루"], "category": "카메라", "confidence": "high", "reason": "카메라 매장"},
            {"key": keys["(주)케이지이니시스"], "category": "모름", "confidence": "low", "reason": "결제대행사"},
        ]})
        res = ai.suggest(s, client=fake)
    assert res["suggested"] == 1 and res["asked"] == 2
    assert "김" not in json.dumps(fake.sent["messages"], ensure_ascii=False)  # no people's names sent
    items = client.get("/api/transactions", params={"view": "uncategorized"}).json()["items"]
    cam = next(t for t in items if t["merchant"] == "포토마루")
    assert cam["category"] == "미분류" and cam["ai"]["category"] == "카메라"
    # Accepting = an ordinary category edit; the suggestion then disappears.
    client.patch(f"/api/transactions/{cam['id']}", json={"category": "카메라"})
    with Session(engine) as s:
        assert s.get(Txn, cam["id"]).ai_category is None


def test_budget_line_validation(client):
    assert client.post("/api/budget/lines", json={"name": "x", "kind": "weird", "monthly_amount": 1}).status_code == 422
    with Session(engine) as s:
        assert s.exec(select(BudgetLine)).all() == []


def test_edit_endpoints_return_the_saved_row(client):
    upload(client, make_export([("2026-09-01", "10:00:00", "지출", "식비", "한식", "김밥", -5000, "대한항공카드 120")]),
           "2026-09-01~2026-09-30.xlsx")
    acc = client.get("/api/accounts").json()[0]
    assert acc["issuer"] is None  # not derivable from the card's name
    r = client.patch(f"/api/accounts/{acc['id']}", json={"issuer": "현대"}).json()
    assert r["id"] == acc["id"] and r["issuer"] == "현대"
    rule = client.post("/api/rules", json={"pattern": "김밥", "set_category": "식비"}).json()
    assert rule["id"] and rule["pattern"] == "김밥"
    assert client.put(f"/api/rules/{rule['id']}", json={**rule, "set_category": "카페/간식"}).json()["set_category"] == "카페/간식"
