import json
import sqlite3
from datetime import date, datetime
from types import SimpleNamespace

from sqlmodel import Session, select

from app.db import engine
from app.engine import assistant as A
from app.engine import backup as BK
from app.engine import claude
from app.engine import recurring as R
from app.engine import running as RUN
from app.models import Account, Goal, Txn
from app.routers.goals import maturity
from app.tools import restore
from tests.conftest import make_export, upload

BANK = "신한 주거래 우대통장(저축예금)"
CARD = "삼성카드 & MILEAGE PLATINUM (스카이패스)"


def acc_id(name: str) -> int:
    with Session(engine) as s:
        return s.exec(select(Account).where(Account.name == name)).one().id


# ---------- recurring ----------

def test_recurring_detects_monthly_subscription_and_can_hide_it(client):
    rows = [(f"2026-{m:02d}-03", "09:00:00", "지출", "온라인쇼핑", "서비스구독", "넷플릭스", -17000, CARD) for m in range(4, 10)]
    rows += [("2026-05-11", "12:00:00", "지출", "식비", "한식", "김밥천국", -8000, CARD),
             ("2026-08-20", "12:00:00", "지출", "식비", "한식", "김밥천국", -9000, CARD)]
    upload(client, make_export(rows))
    with Session(engine) as s:
        items = R.detect(s, today=date(2026, 9, 20))
    assert [i["merchant"] for i in items] == ["넷플릭스"]
    netflix = items[0]
    assert netflix["cadence"] == "monthly" and netflix["amount"] == 17000 and netflix["next_date"] == "2026-10-03"
    up = R.upcoming(items, today=date(2026, 9, 20), days=45)
    assert [u["date"] for u in up] == ["2026-10-03", "2026-11-03"]

    client.post("/api/recurring/ignore", json={"key": netflix["key"]})
    assert client.get("/api/recurring").json()["items"] == []


# ---------- balance check ----------

def test_balance_check_finds_unrecorded_money(client):
    rows = [
        ("2026-01-10", "10:00:00", "수입", "급여", "미분류", "급여", 2_000_000, BANK),
        ("2026-02-10", "10:00:00", "이체", "이체", "미분류", "집주인", -1_000_000, BANK),
        ("2026-03-10", "10:00:00", "수입", "급여", "미분류", "급여", 2_000_000, BANK),
    ]
    upload(client, make_export(rows, balances=[("자유입출금 자산", BANK, 3_500_000)]))
    aid = acc_id(BANK)
    r = client.get(f"/api/checks/{aid}").json()
    assert r["anchor"]["amount"] == 3_500_000 and r["opening_implied"] == 500_000

    # The statement says 1월 말 잔액 2,800,000 — the ledger implies 2,500,000:
    # 30만 원 left the account after January without being recorded.
    r = client.post("/api/checks", json={"account_id": aid, "on_date": "2026-01-31", "amount": 2_800_000}).json()
    check = r["checks"][0]
    assert check["implied"] == 2_500_000 and check["diff"] == 300_000
    assert r["intervals"][-1]["unrecorded"] == -300_000


# ---------- 적금 maturity ----------

def test_savings_maturity_estimate():
    g = Goal(name="청년도약", kind="savings", start_date=date(2024, 7, 1), target_date=date(2029, 7, 1),
             monthly_amount=700_000, rate=6.0, gov_monthly=24_000, tax_free=True)
    m = maturity(g)
    assert m["months"] == 60 and m["principal"] == 42_000_000
    assert m["interest"] == round(700_000 * 0.06 * 60 * 61 / 2 / 12)  # 6,405,000
    assert m["tax"] == 0 and m["gov"] == 1_440_000
    g.tax_free = False
    assert maturity(g)["tax"] == round(m["interest"] * 0.154)


# ---------- backup ----------

def test_backup_roundtrip(client, tmp_path):
    upload(client, make_export([("2026-09-01", "10:00:00", "지출", "식비", "한식", "김밥", -5000, CARD)]))
    with Session(engine) as s:
        BK.KEY_FILE = tmp_path / "key"  # isolate
        from app.engine.budget import put_setting

        put_setting(s, BK.DIR_KEY, str(tmp_path / "bk"))
        s.commit()
        res = BK.create_backup(s)
        st = BK.status(s)
    assert st["files"][0]["name"] == res["file"]
    blob = (tmp_path / "bk" / res["file"]).read_bytes()
    assert b"SQLite" not in blob  # encrypted
    target = tmp_path / "restored.db"
    assert restore.main([str(tmp_path / "bk" / res["file"]), "--key", str(BK.KEY_FILE), "--to", str(target)]) == 0
    con = sqlite3.connect(target)
    assert con.execute("select merchant from txn").fetchone()[0] == "김밥"


# ---------- running (RunLab read-only) ----------

def _fake_runlab(path):
    con = sqlite3.connect(path)
    con.executescript("""
        create table activity (id integer primary key, sport text, start_time text, distance_m real, shoe_id integer);
        create table gear (id integer primary key, name text, brand text, purchased_on text, retire_at_km real,
                           initial_km real, retired integer);
        create table goalrace (id integer primary key, name text, race_day text, distance_m real);
        insert into gear values (1, 'Novablast', 'ASICS', '2026-05-01', 700, 0, 0);
        insert into activity values (1, 'running', '2026-09-03 07:00:00', 10000, 1);
        insert into activity values (2, 'running', '2026-09-10 07:00:00', 15000, 1);
        insert into activity values (3, 'cycling', '2026-09-11 07:00:00', 40000, null);
        insert into goalrace values (1, 'JTBC 마라톤', '2026-11-01', 42195);
    """)
    con.commit()
    con.close()


def test_running_costs_with_runlab(client, tmp_path):
    db = tmp_path / "runlab.db"
    _fake_runlab(db)
    upload(client, make_export([
        ("2026-09-02", "10:00:00", "지출", "패션/쇼핑", "스포츠의류", "아식스 강남", -150_000, CARD),
        ("2026-09-05", "10:00:00", "지출", "문화/여가", "스포츠", "JTBC마라톤 참가비", -100_000, CARD),
    ]))
    with Session(engine) as s:
        shoe = s.exec(select(Txn).where(Txn.merchant == "아식스 강남")).one()
        fee = s.exec(select(Txn).where(Txn.merchant == "JTBC마라톤 참가비")).one()
        RUN.set_link(s, shoe.id, 1, None)
        RUN.set_link(s, fee.id, None, 1)
        o = RUN.overview(s, today=date(2026, 9, 30), path=db)
    sep = next(m for m in o["months"] if m["month"] == "2026-09")
    assert sep == {"month": "2026-09", "spend": 250_000, "km": 25.0}
    assert o["cost_per_km"] == 10_000
    assert o["shoes"][0]["price"] == 150_000 and o["shoes"][0]["cost_per_km"] == 6_000
    assert o["races"][0]["fee"] == 100_000
    assert RUN.overview(Session(engine), path=tmp_path / "missing.db")["connected"] is False


# ---------- AI (fake client) ----------

def _resp(content, stop="end_turn"):
    return SimpleNamespace(content=content, stop_reason=stop, model="fake",
                           usage=SimpleNamespace(input_tokens=10, output_tokens=5))


class ScriptedClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kw):
        self.calls.append(json.loads(json.dumps(kw, default=lambda o: o.__dict__)))
        return self.responses.pop(0)


def test_ask_runs_tools_then_answers(client):
    upload(client, make_export([
        ("2026-09-02", "10:00:00", "지출", "식비", "한식", "김밥천국", -8000, CARD),
        ("2026-09-03", "10:00:00", "이체", "이체", "미분류", "김*수", -50000, BANK),
    ]))
    tool_use = SimpleNamespace(type="tool_use", id="tu1", name="find_transactions",
                               input={"start": "2026-09-01", "end": "2026-09-30", "kind": None, "category": None,
                                      "merchant_contains": None, "min_amount": None, "limit": 10, "sort": "date"})
    fake = ScriptedClient([
        _resp([tool_use], stop="tool_use"),
        _resp([SimpleNamespace(type="text", text="9월에는 김밥천국에서 8,000원 썼어요.")]),
    ])
    with Session(engine) as s:
        out = A.ask(s, "9월에 뭐 썼어?", client=fake)
    assert out["answer"].startswith("9월에는") and out["tool_calls"][0]["name"] == "find_transactions"
    second = fake.calls[1]["messages"]
    result = second[-1]["content"][0]
    assert result["type"] == "tool_result" and result["tool_use_id"] == "tu1"
    assert "김*수" not in result["content"] and "(개인)" in result["content"]  # people masked
    assert fake.calls[0]["fallbacks"] == "default"  # default model supports server-side fallback


def test_fallbacks_only_for_models_that_accept_them():
    fake = ScriptedClient([_resp([SimpleNamespace(type="text", text="ok")])])
    claude.create(fake, model="claude-haiku-5-5", max_tokens=10, messages=[])
    assert "fallbacks" not in fake.calls[0] and "betas" not in fake.calls[0]


def test_receipts_and_manual_entry_confirmed_by_export(client):
    upload(client, make_export([("2026-09-01", "10:00:00", "지출", "식비", "한식", "김밥", -5000, CARD)]),
           "2026-09-01~2026-09-30.xlsx")
    fake = ScriptedClient([_resp([SimpleNamespace(type="text", text=json.dumps({"items": [{
        "date": "2026-10-03", "time": "12:10", "merchant": "一蘭 道頓堀", "amount": 1180, "currency": "JPY",
        "krw_amount": 11050, "refund": False, "category": "식비", "memo": None}]}))])])
    with Session(engine) as s:
        items = A.read_receipts(s, [(b"\xff\xd8fake", "image/jpeg")], client=fake)
    assert items[0]["currency"] == "JPY" and items[0]["fx_amount"] == 1180 and items[0]["krw_amount"] == 11050
    assert fake.calls[0]["messages"][0]["content"][0]["type"] == "image"

    card = acc_id(CARD)
    made = client.post("/api/transactions/manual", json=[{
        "account_id": card, "occurred_at": "2026-10-03T12:10:00", "amount": -11050, "merchant": "一蘭 道頓堀",
        "category": "식비", "fx_currency": "jpy", "fx_amount": 1180,
    }]).json()["items"][0]
    assert made["provisional"] and made["fx"]["currency"] == "JPY" and made["category"] == "식비"

    # The card export brings the same charge → the hand entry steps aside; Banksalad rows can't be deleted.
    upload(client, make_export([("2026-10-04", "09:00:00", "지출", "여행/숙박", "해외결제", "ICHIRAN", -11050, CARD)]),
           "2026-10-01~2026-10-09.xlsx")
    oct_ = client.get("/api/transactions", params={"start": "2026-10-01", "end": "2026-10-31"}).json()
    assert oct_["spending"] == 11050 and oct_["total"] == 1
    banksalad_row = oct_["items"][0]
    assert client.delete(f"/api/transactions/{banksalad_row['id']}").status_code == 400
    assert client.delete(f"/api/transactions/{made['id']}").json()["ok"]


def test_fx_details_roll_up_into_trip(client):
    upload(client, make_export([
        ("2026-09-02", "10:00:00", "지출", "여행/숙박", "해외결제", "LOTTE TR BRISBANE", -98_316, CARD),
        ("2026-09-03", "10:00:00", "지출", "식비", "양식", "CAFE BRISBANE", -20_000, CARD),
    ]))
    trip = client.post("/api/trips", json={"name": "브리즈번", "start_date": "2026-09-01", "end_date": "2026-09-07"}).json()
    items = client.get(f"/api/trips/{trip['id']}").json()["items"]
    for t, aud in zip(sorted(items, key=lambda x: x["amount"]), (100.0, 20.0)):
        client.patch(f"/api/transactions/{t['id']}", json={"fx_currency": "aud", "fx_amount": aud, "fee": 1000})
    d = client.get(f"/api/trips/{trip['id']}").json()
    assert d["fx"] == [{"currency": "AUD", "foreign": 120.0, "krw": 118_316, "count": 2, "rate": round(118_316 / 120, 4)}]
    assert d["fees"] == 2000


def test_mask_people_only_where_names_appear():
    assert A.mask("김*수") == "(개인)"
    assert A.mask("김후영(경주한옥풀빌", "expense", "bank") == "(개인) 경주한옥풀빌"
    assert A.mask("호남집", "expense", "card") == "호남집"
    assert A.mask("최진라", "transfer", "bank") == "(개인)"


def test_cash_account_and_report_context(client):
    r = client.post("/api/accounts", json={"name": "지갑 현금", "kind": "cash"}).json()
    t = client.post("/api/transactions/manual", json=[{
        "account_id": r["id"], "occurred_at": "2026-09-05T10:00:00", "amount": -3000, "merchant": "붕어빵"}]).json()["items"][0]
    assert t["provisional"] is False  # cash never arrives in an export
    with Session(engine) as s:
        ctx = A.month_context(s, "2026-09")
    assert ctx["spending_total"] == 3000 and ctx["largest_payments"][0]["merchant"] == "붕어빵"
    assert isinstance(datetime.now(), datetime)
