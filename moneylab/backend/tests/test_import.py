from datetime import date

from app.engine.classify import auto_kind, infer_account_kind
from app.engine.trips import TripWindow, assign_trip
from tests.conftest import make_export, upload

BANK = "신한 주거래 우대통장(저축예금)"
CARD = "삼성카드 & MILEAGE PLATINUM (스카이패스)"
NPAY = "네이버페이 간편결제"
SAVE = "신한 청년도약계좌"


def by_merchant(client, **params) -> dict[str, dict]:
    items = client.get("/api/transactions", params={"limit": 500, **params}).json()["items"]
    return {t["merchant"]: t for t in items}


def test_account_kinds():
    assert infer_account_kind(BANK) == "bank"
    assert infer_account_kind(CARD) == "card"
    assert infer_account_kind("대한항공카드 120") == "card"
    assert infer_account_kind("Deep Dream(체크)") == "check_card"
    assert infer_account_kind("카카오페이 머니") == "pay"
    assert infer_account_kind(NPAY) == "pay"
    assert infer_account_kind(SAVE) == "savings"


def test_card_bill_is_not_spending_whatever_banksalad_calls_it():
    for typ in ("이체", "지출"):
        assert auto_kind(typ, "삼성카드주식회", "bank") == "card_payment"
        assert auto_kind(typ, "현대카드(주)", "bank") == "card_payment"
    # A transfer to a person that Banksalad mislabelled 카드대금 stays a transfer.
    assert auto_kind("이체", "김민수(펜션)", "bank") == "transfer"


def test_import_classifies_dedupes_and_is_idempotent(client):
    rows = [
        ("2026-03-01", "10:00:00", "지출", "금융", "증권/투자", "삼성카드주식회", -500000, BANK),
        ("2026-03-02", "12:00:00", "지출", "식비", "한식", "김밥천국", -8000, CARD),
        ("2026-03-02", "12:00:00", "지출", "식비", "한식", "김밥천국", -8000, CARD),  # 2 identical
        ("2026-03-05", "09:00:00", "지출", "온라인쇼핑", "인터넷쇼핑", "가민브랜드샵", -819000, NPAY),
        ("2026-03-05", "09:00:05", "지출", "온라인쇼핑", "인터넷쇼핑", "네이버페이", -819000, CARD),
        ("2026-03-10", "08:00:00", "이체", "내계좌이체", "미분류", "홍길동", 700000, SAVE),
        ("2026-03-20", "08:00:00", "수입", "급여", "미분류", "급여", 2000000, BANK),
        ("2026-03-21", "08:00:00", "수입", "금융수입", "미분류", "입출금통장 이자", 0, BANK),
    ]
    data = make_export(rows, balances=[("저축성 자산", SAVE, 19600000)])
    res = upload(client, data)
    assert res["rows_new"] == 7 and res["rows_skipped"] == 1

    t = by_merchant(client, include_dups=True)
    assert t["삼성카드주식회"]["kind"] == "card_payment"
    assert t["가민브랜드샵"]["category"] == "러닝 용품"
    assert t["네이버페이"]["dup_of_id"] == t["가민브랜드샵"]["id"]
    assert t["홍길동"]["kind"] == "savings"

    # Overlapping re-export: nothing new, both identical 김밥천국 rows kept once each.
    again = upload(client, data, "2026-03-01~2026-03-31.xlsx")
    assert again["rows_new"] == 0 and again["already_imported"]
    items = client.get("/api/transactions", params={"q": "김밥"}).json()
    assert items["total"] == 2

    o = client.get("/api/summary/overview").json()
    march = next(m for m in o["months"] if m["month"] == "2026-03")
    assert march["spending"] == 819000 + 16000  # bill and duplicate excluded
    assert march["income"] == 2000000 and march["savings_in"] == 700000
    assert o["corrected"]["card_payments_as_spending"] == {"amount": 500000, "count": 1}
    assert o["balances"]["assets"] == 19600000


def test_manual_edit_survives_reprocessing_and_rules_apply(client):
    rows = [("2026-04-01", "10:00:00", "지출", "온라인쇼핑", "결제/충전", "(주)케이지이니시스",
             -150000, CARD)]
    upload(client, make_export(rows))
    tid = by_merchant(client)["(주)케이지이니시스"]["id"]

    r = client.patch(f"/api/transactions/{tid}", json={"category": "카메라"})
    assert r.json()["category"] == "카메라" and r.json()["locked"]["category"]
    # A later rule must not override a hand edit.
    client.post("/api/rules", json={"pattern": "이니시스", "set_category": "쇼핑"})
    assert by_merchant(client)["(주)케이지이니시스"]["category"] == "카메라"
    # …until the edit is reset.
    client.patch(f"/api/transactions/{tid}", json={"reset": True})
    assert by_merchant(client)["(주)케이지이니시스"]["category"] == "온라인쇼핑"


def test_trip_assignment(client):
    rows = [
        ("2026-05-01", "10:00:00", "지출", "여행/숙박", "항공권", "대한항공", -900000, CARD),
        ("2026-07-02", "10:00:00", "지출", "식비", "일식", "이치란", -15000, CARD),
        ("2026-07-02", "11:00:00", "지출", "온라인쇼핑", "서비스구독", "넷플릭스", -17000, CARD),
        ("2026-07-10", "10:00:00", "지출", "식비", "한식", "김밥천국", -8000, CARD),
    ]
    upload(client, make_export(rows))
    trip = client.post(
        "/api/trips", json={"name": "도쿄", "start_date": "2026-07-01", "end_date": "2026-07-05"}
    ).json()
    assert trip["spent"] == 900000 + 15000  # booking ahead + during, not the subscription

    detail = client.get(f"/api/trips/{trip['id']}").json()
    assert detail["phase"] == {"before": 900000, "during": 15000, "after": 0}


def test_assign_trip_prebooking_stops_at_previous_trip():
    trips = [TripWindow(1, date(2026, 3, 1), date(2026, 3, 5)),
             TripWindow(2, date(2026, 6, 1), date(2026, 6, 5))]
    assert assign_trip(date(2026, 2, 1), "항공", set(), trips) == 1
    assert assign_trip(date(2026, 4, 1), "숙박", set(), trips) == 2
    assert assign_trip(date(2026, 3, 3), "구독", {"구독"}, trips) is None
    assert assign_trip(date(2026, 4, 1), "식비", set(), trips) is None


def test_non_banksalad_file_points_to_column_mapping(client):
    r = client.post("/api/imports", files=[("files", ("x.xlsx", b"not excel", "application/octet-stream"))])
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "not_banksalad"
