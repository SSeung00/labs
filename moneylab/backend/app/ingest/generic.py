"""Any bank / card statement file (xlsx, xls, csv, or the HTML-table '.xls' many banks emit).

Layouts differ per institution and change over time, so instead of hard-coding parsers we
find the header row, guess which column is which, let the user confirm, and remember the
confirmed mapping by the header's signature (ImportTemplate).
"""

import csv
import hashlib
import io
import re
from dataclasses import dataclass
from datetime import date, datetime, time
from html.parser import HTMLParser

import openpyxl

from app.ingest.banksalad import ExportFormatError, Row

HEADER_SCAN_ROWS = 40

_DATE_HINTS = ("일시", "일자", "날짜", "거래일", "이용일", "승인일", "결제일", "date")
_TIME_HINTS = ("시간", "시각", "time")
# In priority order: banks put the counterparty in 내용 and the transaction type in 적요.
_MERCHANT_HINTS = ("가맹점", "이용처", "이용하신곳", "거래처", "상호", "받는분", "보낸분", "거래내용", "기재내용", "내용", "적요")
_AMOUNT_HINTS = ("이용금액", "승인금액", "결제금액", "거래금액", "금액")
_OUT_HINTS = ("출금", "찾으신", "지급")
_IN_HINTS = ("입금", "맡기신")
_MEMO_HINTS = ("비고", "메모", "적요", "구분", "상태", "취소", "할부")
_CANCEL_WORDS = ("취소", "승인취소", "매입취소")


# ---------- reading ----------

class _TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._row is not None and self._cell is not None:
            self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            self.rows.append(self._row)
            self._row = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "cp949", "euc-kr"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _merge_pages(sheets: list[list[list]]) -> list[list]:
    """Banks often split one statement into "Page 1..N" sheets, each repeating the header.

    Keep the first sheet whole and append the data rows of every later sheet whose header
    matches; unrelated sheets (summaries, notices) are left out.
    """
    sheets = [s for s in sheets if s]
    if len(sheets) <= 1:
        return sheets[0] if sheets else []
    try:
        h0 = find_header(sheets[0])
    except ExportFormatError:
        return max(sheets, key=len)
    head0 = sheets[0][h0]
    sig = signature(head0)
    cols0 = [i for i, c in enumerate(head0) if _t(c)]
    out = list(sheets[0])
    for sh in sheets[1:]:
        try:
            h = find_header(sh)
        except ExportFormatError:
            continue
        if signature(sh[h]) != sig:
            continue
        # Same header, but a page may have an extra/missing spacer column: re-align by header cell.
        cols = [i for i, c in enumerate(sh[h]) if _t(c)]
        for r in sh[h + 1:]:
            row = [""] * len(head0)
            for c0, c in zip(cols0, cols):
                if c < len(r):
                    row[c0] = r[c]
            out.append(row)
    return out


def read_table(data: bytes, filename: str) -> list[list]:
    """The statement as one list of rows (all page-sheets joined, or the HTML table)."""
    name = filename.lower()
    head = data[:2048].lstrip().lower()
    if head.startswith(b"<") or b"<table" in head or b"<html" in head:
        p = _TableParser()
        p.feed(_decode(data))
        if not p.rows:
            raise ExportFormatError("표를 찾지 못했어요.")
        return p.rows
    if data[:4] == b"PK\x03\x04":
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        return _merge_pages([[list(r) for r in ws.iter_rows(values_only=True)] for ws in wb.worksheets])
    if data[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":  # legacy .xls (OLE2)
        try:
            import xlrd
        except ImportError as e:  # pragma: no cover
            raise ExportFormatError(".xls 파일을 읽으려면 xlrd가 필요해요.") from e
        try:
            book = xlrd.open_workbook(file_contents=data)
        except Exception as e:
            raise ExportFormatError("엑셀 파일을 열 수 없어요. 암호가 걸려 있다면 풀고 올려 주세요.") from e
        sheets = []
        for sh in book.sheets():
            rows = []
            for i in range(sh.nrows):
                row = []
                for c in sh.row(i):
                    if c.ctype == xlrd.XL_CELL_DATE:
                        row.append(xlrd.xldate.xldate_as_datetime(c.value, book.datemode))
                    else:
                        row.append(c.value)
                rows.append(row)
            sheets.append(rows)
        return _merge_pages(sheets)
    if name.endswith((".csv", ".txt")) or b"," in head:
        text = _decode(data)
        return [r for r in csv.reader(io.StringIO(text))]
    raise ExportFormatError("엑셀(.xlsx/.xls) 또는 CSV 파일만 읽을 수 있어요.")


# ---------- header & mapping ----------

def _t(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return " ".join(str(v).split())


def _has(cell: str, hints) -> bool:
    c = cell.replace(" ", "").lower()
    return any(h in c for h in hints)


def find_header(rows: list[list]) -> int:
    best, best_score = -1, 0
    for i, r in enumerate(rows[:HEADER_SCAN_ROWS]):
        cells = [_t(c) for c in r]
        score = sum(
            1 for hints in (_DATE_HINTS, _MERCHANT_HINTS, _AMOUNT_HINTS + _OUT_HINTS + _IN_HINTS)
            if any(_has(c, hints) and len(c) <= 20 for c in cells)
        )
        if score > best_score:
            best, best_score = i, score
    if best_score < 2:
        raise ExportFormatError("머리글(날짜·내용·금액) 줄을 찾지 못했어요. 거래내역 파일이 맞나요?")
    return best


def signature(header: list) -> str:
    norm = "|".join(_t(c).replace(" ", "") for c in header if _t(c))
    return hashlib.sha1(norm.encode()).hexdigest()


def _first(header: list[str], hints, exclude: set[int] = frozenset()) -> int | None:
    for i, c in enumerate(header):
        if i not in exclude and c and _has(c, hints) and len(c) <= 20:
            return i
    return None


def guess_mapping(header_row: list) -> dict:
    h = [_t(c) for c in header_row]
    used: set[int] = set()

    def pick(hints):
        i = _first(h, hints, used)
        if i is not None:
            used.add(i)
        return i

    def pick_ranked(hints):
        """First hint (in priority order) that some unused column matches."""
        for hint in hints:
            i = _first(h, (hint,), used)
            if i is not None:
                used.add(i)
                return i
        return None

    m: dict = {"date": pick(_DATE_HINTS)}
    m["time"] = pick(_TIME_HINTS)
    m["out"] = pick(_OUT_HINTS)
    m["in"] = pick(_IN_HINTS)
    m["amount"] = None if (m["out"] is not None or m["in"] is not None) else pick(_AMOUNT_HINTS)
    m["merchant"] = pick_ranked(_MERCHANT_HINTS)
    m["memo"] = pick_ranked(_MEMO_HINTS)
    # Card statements list spending as positive numbers; bank 거래금액 columns are signed.
    m["sign"] = "expense_positive" if m["amount"] is not None and any(
        _has(c, ("이용", "승인", "결제")) for c in h
    ) else "signed"
    return m


# ---------- values ----------

_DATE_RE = re.compile(r"(\d{4})[.\-/년 ]\s*(\d{1,2})[.\-/월 ]\s*(\d{1,2})")
_SHORT_DATE_RE = re.compile(r"^(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})")
_TIME_RE = re.compile(r"(\d{1,2}):(\d{2})(?::(\d{2}))?")


def parse_when(v, tv=None) -> datetime | None:
    if isinstance(v, datetime):
        d = v
    elif isinstance(v, date):
        d = datetime.combine(v, time())
    else:
        s = _t(v)
        m = _DATE_RE.search(s) or _SHORT_DATE_RE.search(s)
        if not m:
            if s.isdigit() and len(s) == 8:
                d = datetime(int(s[:4]), int(s[4:6]), int(s[6:]))
            else:
                return None
        else:
            y = int(m.group(1))
            y = y + 2000 if y < 100 else y
            try:
                d = datetime(y, int(m.group(2)), int(m.group(3)))
            except ValueError:
                return None
        tm = _TIME_RE.search(s[m.end():] if m else "")
        if tm and tv is None:
            d = d.replace(hour=int(tm.group(1)), minute=int(tm.group(2)), second=int(tm.group(3) or 0))
    if tv is not None and tv != "":
        if isinstance(tv, time):
            d = datetime.combine(d.date(), tv)
        elif isinstance(tv, datetime):
            d = datetime.combine(d.date(), tv.time())
        elif isinstance(tv, float) and 0 <= tv < 1:  # Excel time fraction
            secs = round(tv * 86400)
            d = d.replace(hour=secs // 3600, minute=secs % 3600 // 60, second=secs % 60)
        else:
            tm = _TIME_RE.search(_t(tv))
            if tm:
                d = d.replace(hour=int(tm.group(1)), minute=int(tm.group(2)), second=int(tm.group(3) or 0))
    return d


def parse_amount(v) -> int | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return round(v)
    s = _t(v).replace(",", "").replace("원", "").replace(" ", "")
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    try:
        n = round(float(s))
    except ValueError:
        return None
    return -n if neg else n


@dataclass
class Parsed:
    rows: list[Row]
    skipped: int
    first: date | None
    last: date | None


def parse_rows(table: list[list], header_idx: int, mapping: dict, account: str,
               account_kind: str) -> Parsed:
    def cell(r, key):
        i = mapping.get(key)
        return r[i] if i is not None and i < len(r) else None

    rows: list[Row] = []
    skipped = 0
    for r in table[header_idx + 1:]:
        when = parse_when(cell(r, "date"), cell(r, "time"))
        if not when:
            skipped += 1
            continue
        if mapping.get("out") is not None or mapping.get("in") is not None:
            out_v = parse_amount(cell(r, "out")) or 0
            in_v = parse_amount(cell(r, "in")) or 0
            amount = in_v - abs(out_v)
        else:
            amount = parse_amount(cell(r, "amount"))
            if amount is None:
                skipped += 1
                continue
            if mapping.get("sign") == "expense_positive":
                amount = -amount
        memo = _t(cell(r, "memo")) or None
        merchant_i = mapping.get("merchant")
        rest = " ".join(_t(c) for i, c in enumerate(r) if i != merchant_i)
        # Card statements list a cancellation as a positive amount with a 취소 note; bank
        # statements already put it in the 입금 column, so only flip single-column amounts.
        single = mapping.get("out") is None and mapping.get("in") is None
        if single and any(w in rest for w in _CANCEL_WORDS) and amount < 0:
            amount = -amount  # cancellation rows refund the original
        if amount == 0:
            skipped += 1
            continue
        merchant = _t(cell(r, "merchant"))
        if account_kind in ("card", "check_card"):
            src_type = "지출"
        elif amount > 0 and re.search(r"급여|이자|상여", merchant):
            src_type = "수입"
        else:
            src_type = mapping.get("bank_default", "이체")
        rows.append(Row(
            occurred_at=when, src_type=src_type, src_cat="", src_sub="", merchant=merchant,
            amount=amount, currency="KRW", account=account, memo=memo,
        ))
    dates = [r.occurred_at.date() for r in rows]
    return Parsed(rows, skipped, min(dates) if dates else None, max(dates) if dates else None)


def preview_rows(table: list[list], header_idx: int, n: int = 8) -> list[list[str]]:
    out = []
    for r in table[header_idx + 1:]:
        cells = [_t(c) if not isinstance(c, (datetime, date)) else c.isoformat(sep=" ") for c in r]
        if any(cells):
            out.append(cells)
        if len(out) >= n:
            break
    return out
