"""Check card rows against the card company's monthly statements (이용대금명세서).

Supported: 삼성카드 statement .xlsx (sheets 일시불 / 할부 / 연회비-기타수수료 / 해외이용 /
결제 취소내역) and 현대카드 statement .xls (an HTML table). Each statement line is matched to
a MoneyLab row on that card — or on a pay wallet (네이버페이·카카오페이 charge the card, and
Banksalad may keep only the wallet's row). Overseas lines match within a few percent: the
statement's final amount includes the FX settlement and the 0.2% fee.

`reconcile` is read-only: what matches, what's missing, what MoneyLab has that no statement
lists (holds that were released net to zero), and each bill's total against the payment that
left the bank. `adjust` books what the statements show and Banksalad doesn't — missing lines,
fees, the overseas settlement difference, and what card points or vouchers paid for (the card
row says 700원, the bill says 0원) — as manual rows, once.
"""

from __future__ import annotations

import hashlib
import html
import io
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

import openpyxl
from sqlmodel import Session, col, select

from app.engine.classify import infer_issuer
from app.ingest.banksalad import ExportFormatError
from app.models import Account, Txn

WINDOW = timedelta(days=3)
REFUND_WINDOW = timedelta(days=10)
FX_TOLERANCE = 0.04


@dataclass
class Line:
    used: date
    merchant: str
    amount: int  # what was used (negative = a cancellation)
    billed: int  # what this bill charges for it (원금 + 수수료)
    benefit: str = ""  # 민생회복쿠폰 / 포인트사용 …
    benefit_amount: int = 0
    currency: str | None = None
    foreign: float | None = None
    fee_only: bool = False  # 연회비 / 알림수수료: nothing used, only a fee billed
    until: date | None = None  # a cancellation can post any time up to this day


@dataclass
class Statement:
    issuer: str
    month: str  # YYYY-MM the bill is for
    filename: str
    lines: list[Line] = field(default_factory=list)
    total: int = 0  # what the bill asks for

    @property
    def first(self) -> date | None:
        return min((x.used for x in self.lines), default=None)

    @property
    def last(self) -> date | None:
        return max((x.used for x in self.lines), default=None)


def _num(v) -> int:
    if v is None:
        return 0
    if isinstance(v, (int, float)):
        return round(v)
    s = str(v).replace(",", "").strip()
    if not s or s in ("-",):
        return 0
    try:
        return round(float(s))
    except ValueError:
        return 0


def _month_end(month: str) -> date:
    y, m = map(int, month.split("-"))
    return date(y + m // 12, m % 12 + 1, 1) - timedelta(days=1)


def _month_from(filename: str, text: str = "") -> str:
    m = re.search(r"(20\d{2})(\d{2})\d{2}", filename) or re.search(r"(20\d{2})년\s*(\d{2})월\s*이용대금", text)
    if not m:
        raise ExportFormatError(f"{filename}: 명세서 월을 알 수 없어요.")
    return f"{m.group(1)}-{m.group(2)}"


def _samsung(data: bytes, filename: str) -> Statement:
    wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    st = Statement("삼성", _month_from(filename), filename)
    fx: dict[tuple[date, str], tuple[str, float]] = {}
    for ws in wb.worksheets:
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        head_i = next((i for i, r in enumerate(rows) if r and "이용일" in [str(c or "").strip() for c in r]), None)
        if head_i is None:
            continue
        head = [str(c or "").strip() for c in rows[head_i]]
        idx = {h: i for i, h in enumerate(head) if h}
        for r in rows[head_i + 1:]:
            day = str(r[0] or "").strip()
            if not re.fullmatch(r"\d{8}", day):
                continue
            used = datetime.strptime(day, "%Y%m%d").date()
            if "현지이용금액" in idx:  # 해외이용: FX details for lines listed elsewhere
                merchant = str(r[idx["가맹점"]] or "").strip()
                fx[(used, merchant)] = (str(r[idx["화폐단위"]] or "").strip(), float(_num(r[idx["현지이용금액"]]) or 0))
                continue
            if "취소금액" in idx:  # 결제 취소내역: listed under the original date, refunded later
                amt = _num(r[idx["취소금액"]])
                st.lines.append(Line(used, str(r[idx["이용가맹점"]] or "").strip(), amt, 0, until=_month_end(st.month)))
                continue
            amount = _num(r[idx["이용금액"]])
            billed = _num(r[idx.get("원금", -1)]) + _num(r[idx.get("이자/수수료", -1)]) if "원금" in idx else amount
            st.lines.append(Line(
                used, str(r[idx["가맹점"]] or "").strip(), amount, billed, fee_only="연회비" in ws.title,
                benefit=str(r[idx["이용혜택"]] or "").strip() if "이용혜택" in idx else "",
                benefit_amount=_num(r[idx["혜택금액"]]) if "혜택금액" in idx else 0,
            ))
    for x in st.lines:
        if (x.used, x.merchant) in fx:
            x.currency, x.foreign = fx[(x.used, x.merchant)]
    st.total = sum(x.billed for x in st.lines)
    return st


def _hyundai(data: bytes, filename: str) -> Statement:
    text = data.decode("utf-8", errors="replace")
    st = Statement("현대", _month_from(filename, text), filename)
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", text, re.DOTALL):
        cells = [
            re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", c))).strip()
            for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]\s*>", row, re.DOTALL)
        ]
        if len(cells) < 10:
            continue
        m = re.fullmatch(r"(\d{4})년 (\d{2})월 (\d{2})일", cells[0])
        if not m:
            continue
        merchant, currency, foreign = cells[2], None, None
        fm = re.search(r",([A-Z]{3}):([\d.]+)$", merchant)
        if fm:
            merchant, currency, foreign = merchant[: fm.start()], fm.group(1), float(fm.group(2))
        amount, billed = _num(cells[3]), _num(cells[7]) + _num(cells[9])
        st.lines.append(Line(
            date(int(m[1]), int(m[2]), int(m[3])), merchant, amount or billed, billed,
            currency=currency, foreign=foreign, fee_only=not amount and billed > 0,
        ))
    st.total = sum(x.billed for x in st.lines)
    return st


def parse(data: bytes, filename: str) -> Statement:
    if data[:2] == b"PK":
        return _samsung(data, filename)
    head = data[:20000].decode("utf-8", errors="replace")
    if "이용대금명세서" in head or "이용가맹점" in head:
        return _hyundai(data, filename)
    raise ExportFormatError(f"{filename}: 삼성카드(.xlsx)·현대카드(.xls) 명세서만 읽을 수 있어요.")


def _serialize(t: Txn, names: dict[int, str]) -> dict:
    return {"id": t.id, "date": t.occurred_at.date(), "amount": t.amount, "merchant": t.merchant,
            "title": t.title, "account": names[t.account_id], "dup": bool(t.dup_of_id)}


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]{3,}|[가-힣]{2,}", text.lower()) if w not in NOISE}


NOISE = {"pty", "ltd", "the", "inc", "llc", "주식회사", "com", "www"}


def _pick(x: Line, mode: str, pool: list[Txn], used: set[int], cards: set[int]) -> Txn | None:
    """mode: exact (same amount) | named (overseas, similar amount, similar name) | fx (overseas,
    similar amount — the wallet or Banksalad may show another name)."""
    target = -x.amount
    window = REFUND_WINDOW if x.amount < 0 else WINDOW  # refunds post days after the cancellation
    words = _words(x.merchant)
    best, best_score = None, None
    for t in pool:
        if t.id in used:
            continue
        d = t.occurred_at.date()
        if x.until:
            if not (x.used <= d <= x.until):
                continue
        elif abs(d - x.used) > window:
            continue
        if mode == "exact":
            if t.amount != target:
                continue
        else:
            if not x.currency or t.amount * target <= 0:  # only overseas lines settle differently
                continue
            if abs(t.amount - target) > abs(target) * FX_TOLERANCE:
                continue
            if mode == "named" and not (words & _words(t.merchant)):
                continue
        score = abs((d - x.used).days) * 10 + abs(t.amount - target) / max(abs(target), 1)
        if t.account_id in cards:
            score -= 100  # the card's own row first
        if t.dup_of_id:
            score += 50
        if best_score is None or score < best_score:
            best, best_score = t, score
    if best:
        used.add(best.id)
    return best


def reconcile(session: Session, statements: list[Statement]) -> dict:
    accounts = list(session.exec(select(Account)).all())
    names = {a.id: a.label or a.name for a in accounts}
    wallets = {a.id for a in accounts if a.kind == "pay"}
    out = []
    for issuer in sorted({s.issuer for s in statements}):
        cards = {a.id for a in accounts if a.kind == "card" and (a.issuer or infer_issuer(a.name)) == issuer}
        sts = sorted((s for s in statements if s.issuer == issuer), key=lambda s: s.month)
        first = min(s.first for s in sts if s.first)
        last = max(s.last for s in sts if s.last)
        reach = max([last] + [x.until for s in sts for x in s.lines if x.until])
        pool = list(session.exec(
            select(Txn).where(
                Txn.provisional == False,
                col(Txn.account_id).in_(cards | wallets),
                Txn.occurred_at >= datetime.combine(first - WINDOW, datetime.min.time()),
                Txn.occurred_at < datetime.combine(reach + REFUND_WINDOW + timedelta(days=1), datetime.min.time()),
            )
        ).all())
        used: set[int] = set()

        per_bill = []
        for s in sts:
            matched, fx_diff, benefits = [], [], []
            lines = [x for x in s.lines if x.amount]
            pending = []
            for x in lines:
                t = _pick(x, "exact", pool, used, cards)
                (matched.append((x, t)) if t else pending.append(x))
            for mode in ("named", "fx"):
                left = []
                for x in pending:
                    t = _pick(x, mode, pool, used, cards)
                    (fx_diff.append((x, t)) if t else left.append(x))
                pending = left
            missing = pending
            found = {id(x): t for x, t in matched + fx_diff}
            for x in s.lines:
                if x.benefit and x.benefit_amount:
                    benefits.append((x, found.get(id(x))))
            per_bill.append({
                "month": s.month, "filename": s.filename, "lines": len(s.lines), "total": s.total,
                "first": s.first, "last": s.last,
                "matched": len(matched),
                "fx": [{"date": x.used, "merchant": x.merchant, "statement": -x.amount, "moneylab": t.amount,
                        "diff": -x.amount - t.amount, "currency": x.currency, "foreign": x.foreign, "txn_id": t.id}
                       for x, t in fx_diff],
                "fx_total": sum(-x.amount - t.amount for x, t in fx_diff),
                "missing": [{"date": x.used, "merchant": x.merchant, "amount": x.amount, "currency": x.currency,
                             "fee": x.fee_only} for x in missing],
                "benefits": [{"date": x.used, "merchant": x.merchant, "amount": x.amount, "benefit": x.benefit,
                              "benefit_amount": x.benefit_amount, "txn_id": t.id if t else None}
                             for x, t in benefits],
            })

        # What the card shows in MoneyLab that no statement lists (only within the covered dates).
        # A hold that was released (가승인, 숙소 보증금) shows as a charge and a same-size refund
        # and nets to zero: listed apart, nothing to fix.
        loose = [
            t for t in pool
            if t.account_id in cards and t.id not in used and not t.dup_of_id and t.source != "manual"
            and first <= t.occurred_at.date() <= last and t.kind in ("expense", "claim")
        ]
        holds: set[int] = set()
        for t in loose:
            if t.id in holds or t.amount >= 0:
                continue
            back = next((u for u in loose if u.id not in holds and u.amount == -t.amount
                         and timedelta(0) <= u.occurred_at - t.occurred_at <= timedelta(days=10)), None)
            if back:
                holds |= {t.id, back.id}
        extra = [_serialize(t, names) for t in loose if t.id not in holds]
        released = [_serialize(t, names) for t in loose if t.id in holds and t.amount < 0]

        # Bill totals against the payments that left the bank in that month.
        pay_rows = session.exec(select(Txn).where(Txn.kind == "card_payment", Txn.amount < 0)).all()
        paid_by_month: dict[str, list[int]] = defaultdict(list)
        for t in pay_rows:
            if infer_issuer(t.merchant) == issuer:
                paid_by_month[t.occurred_at.strftime("%Y-%m")].append(-t.amount)
        for b in per_bill:
            paid = paid_by_month.get(b["month"], [])
            b["bank_paid"] = sum(paid)
            b["bank_payments"] = paid
        out.append({"issuer": issuer, "cards": [names[c] for c in sorted(cards)], "card_ids": sorted(cards),
                    "first": first, "last": last, "bills": per_bill,
                    "extra": sorted(extra, key=lambda e: e["date"]),
                    "released": sorted(released, key=lambda e: e["date"])})
    return {"issuers": out}


FEE_CATEGORY = "카드·금융 수수료"
BENEFIT_ACCOUNT = "카드 혜택(포인트·쿠폰)"


def benefit_key(txn_id: int) -> str:
    return hashlib.sha1(f"cardstmt|benefit|{txn_id}".encode()).hexdigest()


def offset_benefit(session: Session, t: Txn, amount: int, benefit: str) -> bool:
    """Book what points / a voucher paid for a purchase as a same-category credit, so the purchase
    keeps its category but costs only what the card actually charged. False if already booked
    (here, or as a voucher by the old-ledger import)."""
    keys = (benefit_key(t.id), hashlib.sha1(f"voucher|{t.id}".encode()).hexdigest())
    if session.exec(select(Txn).where(col(Txn.base_key).in_(keys))).first():
        return False
    acc = session.exec(select(Account).where(Account.name == BENEFIT_ACCOUNT)).first()
    if not acc:
        acc = Account(name=BENEFIT_ACCOUNT, kind="other", hidden=True)
        session.add(acc)
        session.flush()
    session.add(Txn(
        account_id=acc.id, occurred_at=t.occurred_at + timedelta(seconds=1), amount=amount,
        merchant=f"{benefit}: {t.merchant}", title=f"{benefit} 결제분", src_type="지출", source="manual",
        base_key=keys[0], occurrence=1, kind="expense", kind_locked=True,
        category=t.category, category_locked=True, note=f"카드 명세서: {benefit}로 낸 금액",
    ))
    return True


def adjust(session: Session, statements: list[Statement]) -> dict:
    """Book what the statements charged and MoneyLab lacks, once (keyed by statement line)."""
    result = reconcile(session, statements)
    added = []

    def book(card_id: int, key: str, day: date, amount: int, merchant: str, title: str, note: str,
             category: str | None) -> None:
        base = hashlib.sha1(f"cardstmt|{key}".encode()).hexdigest()
        if session.exec(select(Txn).where(Txn.base_key == base)).first():
            return
        t = Txn(account_id=card_id, occurred_at=datetime.combine(day, datetime.min.time()).replace(hour=12),
                amount=amount, merchant=merchant, title=title, note=note, src_type="지출", source="manual",
                base_key=base, occurrence=1, kind="expense", kind_locked=True)
        if category:
            t.category, t.category_locked = category, True
        session.add(t)
        added.append({"date": day, "amount": amount, "title": title})

    def like(card_ids: list[int], merchant: str) -> str | None:
        """Category of an earlier row from the same place (an Opal fare → 대중교통)."""
        words = _words(merchant)
        for t in session.exec(select(Txn).where(col(Txn.account_id).in_(card_ids), Txn.kind == "expense")
                              .order_by(col(Txn.occurred_at).desc())).all():
            if words & _words(t.merchant) and t.category not in ("미분류", "기타"):
                return t.category
        return None

    for iss in result["issuers"]:
        if not iss["card_ids"]:
            continue
        card = iss["card_ids"][0]
        for b in iss["bills"]:
            for i, m in enumerate(b["missing"]):
                if m["amount"] <= 0:
                    continue  # an unmatched refund: nothing to add, shown in the report
                book(card, f"{iss['issuer']}|{b['month']}|miss|{m['date']}|{m['merchant']}|{m['amount']}|{i}",
                     m["date"], -m["amount"], m["merchant"], m["merchant"],
                     f"{b['month']} 카드 명세서에만 있던 {'수수료' if m['fee'] else '결제'}",
                     FEE_CATEGORY if m["fee"] else like(iss["card_ids"], m["merchant"]))
            for x in b["benefits"]:
                t = session.get(Txn, x["txn_id"]) if x["txn_id"] else None
                if t and offset_benefit(session, t, -x["benefit_amount"], x["benefit"]):
                    added.append({"date": x["date"], "amount": -x["benefit_amount"], "title": f"{x['benefit']} 결제분"})
            if b["fx_total"]:
                last_day = max(f["date"] for f in b["fx"])
                book(card, f"{iss['issuer']}|{b['month']}|fx", last_day, b["fx_total"],
                     f"{iss['issuer']}카드 해외결제 정산", "해외결제 환율·수수료 차액",
                     f"{b['month']} 명세서 청구액과 뱅크샐러드 금액의 차이 ({len(b['fx'])}건)", FEE_CATEGORY)
    session.commit()
    from app.engine.pipeline import reprocess

    reprocess(session)
    return {"added": added, "report": reconcile(session, statements)}
