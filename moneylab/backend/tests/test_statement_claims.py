from io import BytesIO

import openpyxl
from sqlmodel import Session, select

from app.db import engine
from app.ingest import generic
from app.models import Account
from tests.conftest import make_export, upload

BANK = "신한 주거래 우대통장(저축예금)"
CHECK = "Deep Dream(체크)"
CARD = "삼성카드 & MILEAGE PLATINUM (스카이패스)"


def acc_id(name):
    with Session(engine) as s:
        return s.exec(select(Account).where(Account.name == name)).one().id


def shinhan_statement(rows_by_page: list[list[tuple]]) -> bytes:
    """Like Shinhan's export: one sheet per page, page 1 with an extra spacer column."""
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for i, rows in enumerate(rows_by_page):
        ws = wb.create_sheet(f"Page {i + 1}")
        ws.append([])
        ws.append(["", "조회기간", "", "2024.05.01 ~ 2026.10.09"])
        ws.append([])
        spacer = i == 0
        head = ["", "거래일자", "거래시간"] + ([""] if spacer else []) + ["적요", "출금", "", "입금", "", "내용", "잔액", "", "거래점"]
        ws.append(head)
        for d, t, kind, out, inn, who, bal in rows:
            ws.append(["", d, t] + ([""] if spacer else []) + [kind, out, "", inn, "", who, bal, "", "x"])
        ws.append(["", "ⓒ SHINHAN BANK.", "", "", "", f"({len(rows_by_page)}-{i + 1})"])
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


STATEMENT = shinhan_statement([
    [  # newest first, like the bank
        ("2026-09-10", "10:00:00", "체크카드", "9,000", "", "라귤", "1,991,000"),
        ("2026-09-05", "09:00:00", "급여", "", "2,000,000", "연구비급여", "2,000,000"),
    ],
    [
        ("2026-09-01", "12:00:00", "모바일", "300,000", "", "집주인", "0"),
        ("2026-08-31", "12:00:00", "모바일", "", "300,000", "엄마", "300,000"),
    ],
])


def test_multi_page_statement_is_joined_and_realigned():
    table = generic.read_table(STATEMENT, "report.xls")
    h = generic.find_header(table)
    m = generic.guess_mapping(table[h])
    assert table[h][m["merchant"]] == "내용" and table[h][m["memo"]] == "적요"
    parsed = generic.parse_rows(table, h, m, "x", "bank")
    assert sorted(r.amount for r in parsed.rows) == [-300_000, -9_000, 300_000, 2_000_000]


def test_statement_reconcile_links_payments_booked_elsewhere(client):
    rows = [
        ("2026-09-01", "12:00:00", "이체", "이체", "미분류", "집주인", -300_000, BANK),
        ("2026-09-05", "09:00:00", "수입", "급여", "미분류", "연구비급여", 2_000_000, BANK),
        ("2026-09-10", "10:00:05", "지출", "카페/간식", "디저트/떡", "라귤", -9_000, CHECK),  # booked on the check card
    ]
    upload(client, make_export(rows, balances=[("자유입출금 자산", BANK, 1_991_000)]))
    bank = acc_id(BANK)
    before = client.get(f"/api/checks/{bank}").json()
    assert before["opening_implied"] == 300_000 - 9_000  # check-card payment not yet counted

    r = client.post("/api/checks/statement", data={"account_id": str(bank)},
                    files={"file": ("report.xls", STATEMENT, "application/vnd.ms-excel")}).json()
    assert r["matched"] == 2 and len(r["via_other"]) == 1 and r["missing"] == [] and r["extra"] == []
    assert r["via_other"][0]["booked_on"] == CHECK
    assert r["before"]["rows"] == 1 and r["before"]["balance"] == 300_000
    after = r["report"]
    assert after["opening_implied"] == 300_000  # the check-card payment now counts on the bank
    assert all(i["ok"] for i in after["intervals"])


def test_claim_takes_rows_out_of_spending_and_tracks_payback(client):
    rows = [
        ("2026-09-03", "10:00:00", "지출", "여행/숙박", "숙박비", "학회 숙소", -400_000, CARD),
        ("2026-09-03", "11:00:00", "지출", "교육/학습", "시험료", "학회 등록비", -100_000, CARD),
        ("2026-09-20", "09:00:00", "이체", "이체", "미분류", "서울대산학협력단", 450_000, BANK),
    ]
    upload(client, make_export(rows))
    items = client.get("/api/transactions", params={"start": "2026-09-01", "end": "2026-09-30"}).json()
    assert items["spending"] == 500_000
    ids = [t["id"] for t in items["items"] if t["amount"] < 0]
    payback = next(t for t in items["items"] if t["amount"] > 0)

    c = client.post("/api/claims", json={"name": "통계학회", "txn_ids": ids}).json()
    assert c["paid"] == 500_000 and c["outstanding"] == 500_000
    assert client.get("/api/transactions", params={"start": "2026-09-01", "end": "2026-09-30"}).json()["spending"] == 0

    detail = client.get(f"/api/claims/{c['id']}").json()
    assert detail["candidates"][0]["id"] == payback["id"]
    detail = client.post(f"/api/claims/{c['id']}/link", json={"txn_ids": [payback["id"]]}).json()
    assert detail["reimbursed"] == 450_000 and detail["outstanding"] == 50_000
    assert client.get("/api/claims").json()["outstanding"] == 50_000

    # 5만 원 never came back → closing books it as my own spending, once.
    closed = client.post(f"/api/claims/{c['id']}/close", json={"book_shortfall": True}).json()
    assert closed["status"] == "closed"
    sep = client.get("/api/transactions", params={"start": "2026-09-01", "end": "2026-12-31"}).json()
    assert sep["spending"] == 50_000
    client.post(f"/api/claims/{c['id']}/reopen")
    assert client.get("/api/transactions", params={"start": "2026-09-01", "end": "2026-12-31"}).json()["spending"] == 0


def test_open_claim_appears_in_cash_plan(client):
    upload(client, make_export([("2026-09-03", "10:00:00", "지출", "교육/학습", "시험료", "학회 등록비", -100_000, CARD)]))
    tid = client.get("/api/transactions").json()
    tid = client.get("/api/transactions", params={"start": "2026-09-01", "end": "2026-09-30"}).json()["items"][0]["id"]
    client.post("/api/claims", json={"name": "학회", "txn_ids": [tid], "expected_date": "2099-01-15"})
    f = client.get("/api/plan/forecast", params={"months": 3}).json()
    assert not any("학회" in e["name"] for m in f["months"] for e in m["events"])  # beyond 3 months
    client.put("/api/claims/1", json={"name": "학회", "expected_date": None})
    f = client.get("/api/plan/forecast", params={"months": 3}).json()
    names = [e["name"] for m in f["months"] for e in m["events"]]
    assert any("학회" in n for n in names)


def test_feeder_row_also_on_the_bank_is_counted_once(client):
    rows = [
        ("2026-09-02", "10:00:00", "수입", "기타수입", "환불", "Adyen 환불", 50_000, CHECK),
        ("2026-09-02", "10:00:01", "수입", "기타수입", "환불", "Adyen", 50_000, BANK),  # same refund, both sides
        ("2026-09-03", "08:00:00", "지출", "교통", "버스", "09월서울버스1건", -1_500, CHECK),
        ("2026-09-09", "08:00:00", "지출", "교통", "버스", "신한체크교통", -1_500, BANK),  # 후불교통, days later
        ("2026-09-10", "10:00:00", "지출", "카페/간식", "디저트/떡", "라귤", -9_000, CHECK),  # only on the card
    ]
    upload(client, make_export(rows, balances=[("자유입출금 자산", BANK, 100_000)]))
    with Session(engine) as s:
        check = s.get(Account, acc_id(CHECK))
        check.funding_account_id = acc_id(BANK)
        s.add(check)
        s.commit()
    r = client.get(f"/api/checks/{acc_id(BANK)}").json()
    assert r["opening_implied"] == 100_000 - 50_000 + 1_500 + 9_000
