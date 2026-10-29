import os
import tempfile
from datetime import datetime, time
from io import BytesIO

import openpyxl
import pytest

# Point the app at a throwaway data dir before anything imports app.config.
os.environ["MONEYLAB_DATA_DIR"] = tempfile.mkdtemp(prefix="moneylab-test-")
os.environ["MONEYLAB_NO_BACKUP"] = "1"
os.environ["MONEYLAB_BACKUP_KEY"] = os.path.join(os.environ["MONEYLAB_DATA_DIR"], "backup.key")

from fastapi.testclient import TestClient
from sqlmodel import SQLModel

from app.db import engine
from app.main import app

HEADER = ["날짜", "시간", "타입", "대분류", "소분류", "내용", "금액", "화폐", "결제수단", "메모"]


def make_export(rows: list[tuple], balances: list[tuple] = ()) -> bytes:
    """rows: (YYYY-MM-DD, HH:MM:SS, 타입, 대분류, 소분류, 내용, 금액, 결제수단)."""
    wb = openpyxl.Workbook()
    summary = wb.active
    summary.title = "뱅샐현황"
    summary.append([None, "3.재무현황"])
    summary.append([None, "항목", "상품명", None, "금액", "항목", "상품명", None, "금액"])
    for group, name, amount in balances:
        summary.append([None, group, name, None, amount])
    summary.append([None, "총자산", None, None, 0, "총부채"])
    ws = wb.create_sheet("가계부 내역")
    ws.append(HEADER)
    for d, t, typ, cat, sub, merchant, amount, account in rows:
        h, m, s = map(int, t.split(":"))
        ws.append([datetime.fromisoformat(d), time(h, m, s), typ, cat, sub, merchant, amount, "KRW",
                   account, None])
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


@pytest.fixture
def client():
    SQLModel.metadata.drop_all(engine)
    with TestClient(app, base_url="http://localhost", client=("127.0.0.1", 50000)) as c:
        yield c


def upload(client, data: bytes, name: str = "2026-01-01~2026-12-31.xlsx") -> dict:
    files = [("files", (name, data, "application/octet-stream"))]
    r = client.post("/api/imports", files=files)
    assert r.status_code == 200, r.text
    return r.json()["results"][0]
