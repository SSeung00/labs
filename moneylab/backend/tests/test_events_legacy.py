from sqlmodel import Session, select

from app.db import engine
from app.ingest import legacy
from app.models import Account, Txn
from tests.conftest import make_export, upload

BANK = "신한 주거래 우대통장(저축예금)"
CARD = "삼성카드 & MILEAGE PLATINUM (스카이패스)"
KAKAO = "카카오페이 머니"


def txn_by(merchant):
    with Session(engine) as s:
        return s.exec(select(Txn).where(Txn.merchant == merchant)).one()


def test_event_spending_stays_out_of_trip_fund_and_bookings(client):
    rows = [
        ("2026-02-10", "10:00:00", "지출", "여행/숙박", "항공", "대한항공", -900_000, CARD),  # for the trip
        ("2026-03-17", "12:00:00", "지출", "식비", "한식", "경주 식당", -30_000, CARD),  # at the event
        ("2026-03-25", "12:00:00", "지출", "식비", "한식", "동네 식당", -8_000, CARD),
        ("2026-08-28", "12:00:00", "지출", "식비", "한식", "Sydney cafe", -20_000, CARD),
    ]
    upload(client, make_export(rows))
    event = client.post("/api/trips", json={"name": "경주 학회", "kind": "event",
                                            "start_date": "2026-03-16", "end_date": "2026-03-20"}).json()
    trip = client.post("/api/trips", json={"name": "호주", "start_date": "2026-08-27", "end_date": "2026-09-06"}).json()
    assert txn_by("경주 식당").trip_id == event["id"]
    # The flight booked before the event belongs to the trip after it, not to the event.
    assert txn_by("대한항공").trip_id == trip["id"]

    line = client.post("/api/budget/lines", json={"name": "생활비", "kind": "spend", "categories": ["식비"],
                                                  "monthly_amount": 300_000}).json()
    march = client.get("/api/budget", params={"month": "2026-03"}).json()
    assert {u["category"]: u["amount"] for u in march["unbudgeted"]} == {"학회·행사": 30_000}
    assert next(ln for ln in march["lines"] if ln["id"] == line["id"])["actual"] == 8_000


def test_loan_is_an_asset_not_planned_cash_and_surplus_books_income(client):
    rows = [
        ("2026-09-01", "09:00:00", "이체", "이체", "미분류", "엄마", -5_000_000, BANK),
        ("2026-09-03", "10:00:00", "지출", "교통", "철도", "KTX 단체", -100_000, CARD),
        ("2026-09-20", "09:00:00", "이체", "이체", "미분류", "연구실", 130_000, BANK),
    ]
    upload(client, make_export(rows, balances=[("자유입출금 자산", BANK, 1_000_000)]))
    mom = txn_by("엄마").id
    loan = client.post("/api/claims", json={"name": "부모님", "kind": "loan", "txn_ids": [mom]}).json()
    assert loan["outstanding"] == 5_000_000
    f = client.get("/api/plan/forecast", params={"months": 3}).json()
    assert not any("부모님" in e["name"] for m in f["months"] for e in m["events"])
    net = client.get("/api/summary/networth").json()[-1]
    assert net["groups"]["받을 돈"] == 5_000_000

    ktx, back = txn_by("KTX 단체").id, txn_by("연구실").id
    c = client.post("/api/claims", json={"name": "학회", "txn_ids": [ktx, back]}).json()
    assert c["outstanding"] == -30_000
    client.post(f"/api/claims/{c['id']}/close", json={"book_shortfall": True})
    inc = client.get("/api/transactions", params={"kind": "income"}).json()["items"]
    assert [(t["merchant"], t["amount"]) for t in inc] == [("정산 차익: 학회", 30_000)]


def test_ledger_start_removes_and_skips_older_rows(client):
    rows = [
        ("2024-12-30", "10:00:00", "지출", "식비", "한식", "작년 식당", -10_000, CARD),
        ("2025-01-02", "10:00:00", "지출", "식비", "한식", "올해 식당", -20_000, CARD),
    ]
    upload(client, make_export(rows))
    r = client.put("/api/ledger", json={"start": "2025-01-01"}).json()
    assert r["removed"] == 1
    again = upload(client, make_export(rows), name="again.xlsx")
    assert again["rows_new"] == 0
    items = client.get("/api/transactions").json()["items"]
    assert [t["merchant"] for t in items] == ["올해 식당"]


CSV = """Type,Date,Amount,Title,Category,Place,Account,From Account,To Account,Events,Note,Account Impact,From Account Impact,To Account Impact,Month
Expense,"2026-03-17, 12:00:00","₩30,000",학회 저녁,🗣️ Conf,식당,Samsung Card,,,2026 학회,랩비 환급,"-₩30,000",₩0,₩0,Mar 2026
Expense,"2026-03-17, 15:00:00","₩5,000",커피,🗣️ Conf,카페,Samsung Card,,,2026 학회,개인 소비,"-₩5,000",₩0,₩0,Mar 2026
Reimb.,"2026-03-25, 09:00:00","₩30,000",랩비 환급,🗣️ Conf,랩,Checking,,,2026 학회,,"₩30,000",₩0,₩0,Mar 2026
Expense,"2026-04-01, 19:00:00","₩40,000",피자,🍎 Food,피자집,Samsung Card,,,,,"-₩40,000",₩0,₩0,Apr 2026
SettleIn,"2026-04-01, 20:00:00","₩10,000",피자 정산,🍎 Food,Kakao Pay (친구),Kakao Pay,,,,,"₩10,000",₩0,₩0,Apr 2026
Income,"2026-04-02, 09:00:00","₩1,000,000",Tutoring [APR],💵 Income,학부모,Checking,,,,,"₩1,000,000",₩0,₩0,Apr 2026
Expense,"2026-04-03, 12:00:00",₩0,편의점,🍎 Food,GS25,Samsung Card,,,,"4,400, 고유가지원금",₩0,₩0,₩0,Apr 2026
Expense,"2026-04-04, 12:00:00","₩100,000",친구 결혼 축의금,🎁 Gifts,,Checking,,,,,"-₩100,000",₩0,₩0,Apr 2026
Transfer,"2026-04-05, 08:00:00","₩700,000",Savings,🔀 Transfer,,,Checking,Saving,,,₩0,"-₩700,000","₩700,000",Apr 2026
"""


def test_legacy_ledger_annotates_existing_rows(client):
    rows = [
        ("2026-03-17", "12:00:10", "지출", "식비", "한식", "식당", -30_000, CARD),
        ("2026-03-17", "15:00:10", "지출", "카페/간식", "커피", "카페", -5_000, CARD),
        ("2026-03-25", "09:00:10", "이체", "이체", "미분류", "랩", 30_000, BANK),
        ("2026-04-01", "19:00:10", "지출", "식비", "피자", "피자집", -40_000, CARD),
        ("2026-04-01", "20:00:10", "이체", "이체", "미분류", "친*구", 10_000, KAKAO),
        ("2026-04-02", "09:00:10", "이체", "이체", "미분류", "학부모", 1_000_000, BANK),
        ("2026-04-03", "12:00:10", "지출", "생활", "편의점", "GS25", -4_400, CARD),
        ("2026-04-04", "12:00:10", "이체", "이체", "미분류", "출금 내역", -100_000, BANK),
    ]
    upload(client, make_export(rows))
    event = client.post("/api/trips", json={"name": "2026 학회", "kind": "event",
                                            "start_date": "2026-03-16", "end_date": "2026-03-20"}).json()
    with Session(engine) as s:
        r = legacy.apply(s, CSV.encode(), {"2026 학회": event["id"]})
    assert r.matched == 8 and not r.unmatched and r.vouchers == 1

    assert txn_by("식당").kind == "claim" and txn_by("랩").kind == "claim"
    assert txn_by("카페").trip_id == event["id"] and txn_by("카페").kind == "expense"
    friend = txn_by("친*구")
    assert (friend.kind, friend.category, friend.title) == ("expense", "외식", "피자 정산")
    assert (txn_by("학부모").kind, txn_by("학부모").category) == ("income", "과외")

    april = client.get("/api/transactions", params={"start": "2026-04-01", "end": "2026-04-30"}).json()
    # my share of the pizza and the 축의금; the voucher paid for GS25
    assert april["spending"] == 40_000 - 10_000 + 100_000
    assert txn_by("출금 내역").category == "축의·경조"
    detail = client.get(f"/api/trips/{event['id']}").json()
    assert [t["title"] for t in detail["claim_items"]] == ["학회 저녁", "랩비 환급"]
    assert [t["title"] for t in detail["items"]] == ["커피"]
    with Session(engine) as s:
        assert s.exec(select(Account).where(Account.name == legacy.VOUCHER_ACCOUNT)).one().hidden
    claim = client.get("/api/claims").json()["claims"][0]
    assert (claim["name"], claim["trip_name"], claim["outstanding"]) == ("2026 학회 정산", "2026 학회", 0)

    with Session(engine) as s:  # running it again changes nothing
        again = legacy.apply(s, CSV.encode(), {"2026 학회": event["id"]})
    assert again.vouchers == 0 and again.notes == 0


def test_claim_payment_keeps_its_duplicate_out_of_spending(client):
    rows = [
        ("2026-03-06", "14:01:22", "지출", "교통", "철도", "한국철도공사", -188_400, "네이버페이 간편결제"),
        ("2026-03-06", "14:00:03", "지출", "교통", "철도", "한국철도공사_간편", -188_400, CARD),
    ]
    upload(client, make_export(rows))
    month = {"start": "2026-03-01", "end": "2026-03-31"}
    assert client.get("/api/transactions", params=month).json()["spending"] == 188_400
    pay = txn_by("한국철도공사").id
    c = client.post("/api/claims", json={"name": "학회 KTX", "txn_ids": [pay]}).json()
    assert c["paid"] == 188_400
    assert client.get("/api/transactions", params=month).json()["spending"] == 0
    assert txn_by("한국철도공사_간편").dup_of_id == pay


def test_two_level_categories_filter_budget_and_migrate(client):
    rows = [
        ("2026-05-01", "12:00:00", "지출", "식비", "한식", "김밥천국", -8_000, CARD),
        ("2026-05-02", "15:00:00", "지출", "카페/간식", "커피/음료", "스타벅스", -5_000, CARD),
        ("2026-05-03", "09:00:00", "지출", "여행/숙박", "항공권", "대한항공", -500_000, CARD),
    ]
    upload(client, make_export(rows))
    assert txn_by("김밥천국").category == "외식"
    assert txn_by("스타벅스").category == "카페·간식"
    assert txn_by("대한항공").category == "항공"
    cats = {c["name"]: c for c in client.get("/api/categories").json()}
    assert cats["외식"]["parent"] == "식비" and cats["식비"]["parent"] is None and "여행" not in cats
    # A 대분류 filter includes its 소분류.
    may = {"start": "2026-05-01", "end": "2026-05-31"}
    assert client.get("/api/transactions", params={**may, "category": "식비"}).json()["total"] == 2
    # A budget line on the 대분류 counts every 소분류.
    line = client.post("/api/budget/lines", json={"name": "식비", "kind": "spend", "categories": ["식비"],
                                                  "monthly_amount": 300_000}).json()
    month = client.get("/api/budget", params={"month": "2026-05"}).json()
    assert next(ln for ln in month["lines"] if ln["id"] == line["id"])["actual"] == 13_000


def test_card_statement_check_and_adjust(client):
    from app.engine import card_statement as CS

    rows = [
        ("2026-08-28", "09:37:00", "지출", "패션/쇼핑", "스포츠의류", "ASICS OCEANIA PTY LTD 579", -547_241, "대한항공카드 120"),
        ("2026-08-29", "10:00:00", "지출", "식비", "한식", "김밥천국", -8_000, "대한항공카드 120"),
        ("2026-09-01", "09:00:00", "지출", "여행/숙박", "숙박비", "BARONNET APTS", -204_098, "대한항공카드 120"),
        ("2026-09-08", "09:00:00", "지출", "여행/숙박", "숙박비", "BARONNET APTS", 204_098, "대한항공카드 120"),
        ("2026-10-01", "18:28:00", "이체", "카드대금", "미분류", "현대카드(주)", -569_626, BANK),
    ]
    upload(client, make_export(rows))
    with Session(engine) as s:  # 대한항공카드 doesn't say which company: set in 설정 → 계좌·카드
        acc = s.exec(select(Account).where(Account.name == "대한항공카드 120")).one()
        acc.issuer = "현대"
        s.add(acc)
        s.commit()
    row = '<tr><td>{d}</td><td>본인 대한항공카드</td><td>{m}</td><td>{a}</td><td></td><td>0%</td><td>0</td><td>{b}</td><td>0</td><td>{f}</td></tr>'
    html = "<html><table><tr><th>2026년 10월 이용대금명세서</th></tr>" + "".join([
        row.format(d="2026년 08월 28일", m="ASICS OCEANIA PTY LT,AUD:545.00", a="553,326", b="553,326", f="0"),
        row.format(d="2026년 08월 29일", m="김밥천국", a="8,000", b="8,000", f="0"),
        row.format(d="2026년 08월 29일", m="TFNSW OPAL FARE,AUD:8.00", a="8,000", b="8,000", f="0"),
        row.format(d="2026년 09월 19일", m="카드이용알림수수료10월", a="0", b="0", f="300"),
    ]) + "</table></html>"
    st = CS.parse(html.encode(), "hyundaicard_20261001.xls")
    assert (st.issuer, st.month, st.total) == ("현대", "2026-10", 569_626)
    r = client.post("/api/checks/card-statements", files=[("files", ("hyundaicard_20261001.xls", html.encode(), "text/html"))]).json()
    bill = r["report"]["issuers"][0]["bills"][0]
    assert bill["bank_paid"] == bill["total"] == 569_626
    assert bill["matched"] == 1 and bill["fx_total"] == -6_085
    assert {m["merchant"] for m in bill["missing"]} == {"TFNSW OPAL FARE", "카드이용알림수수료10월"}
    assert [e["merchant"] for e in r["report"]["issuers"][0]["released"]] == ["BARONNET APTS"]

    files = [("files", ("hyundaicard_20261001.xls", html.encode(), "text/html"))]
    done = client.post("/api/checks/card-statements", data={"apply": "true"}, files=files).json()
    assert sorted(a["amount"] for a in done["added"]) == [-8_000, -6_085, -300]
    again = client.post("/api/checks/card-statements", data={"apply": "true"}, files=files).json()
    assert again["added"] == [] and not again["report"]["issuers"][0]["bills"][0]["missing"]


def test_card_points_offset_the_purchase(client):
    from io import BytesIO

    import openpyxl

    upload(client, make_export([
        ("2026-07-27", "01:01:01", "지출", "주거/통신", "휴대폰", "휴대폰알림서비스", -700, CARD),
        ("2026-07-28", "12:00:00", "지출", "식비", "한식", "김밥천국", -8_000, CARD),
    ]))
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "일시불"
    ws.append(["일시불"])
    ws.append(["이용일", "이용구분", "가맹점", "이용금액", "총할부금액", "이용혜택", "혜택금액", "개월", "회차", "원금",
               "이자/수수료", "포인트명", "적립금액", "입금후잔액"])
    ws.append(["20260727", "본 인", "휴대폰알림서비스 07월이용료", "700", "", "포인트사용", "-700", "", "", 0, 0, "", 0, 0])
    ws.append(["20260728", "본 인", "김밥천국", "8,000", "", " ", "", "", "", 8000, 0, "", 0, 0])
    buf = BytesIO()
    wb.save(buf)
    files = [("files", ("samsungcard_20260801.xlsx", buf.getvalue(), "application/octet-stream"))]
    july = {"start": "2026-07-01", "end": "2026-07-31"}
    assert client.get("/api/transactions", params=july).json()["spending"] == 8_700
    r = client.post("/api/checks/card-statements", data={"apply": "true"}, files=files).json()
    assert [(a["amount"], a["title"]) for a in r["added"]] == [(700, "포인트사용 결제분")]
    assert client.get("/api/transactions", params=july).json()["spending"] == 8_000
    again = client.post("/api/checks/card-statements", data={"apply": "true"}, files=files).json()
    assert again["added"] == []


def test_recurring_follows_a_subscription_across_merchant_names():
    from app.engine.recurring import series_key

    names = ["ANTHROPIC, PBC", "ANTHROPIC* CLAUDE SUB", "CLAUDE.AI SUBSCRIPTION"]
    assert {series_key(n) for n in names} == {"claude"}
    assert series_key("스타벅스") != "claude"
