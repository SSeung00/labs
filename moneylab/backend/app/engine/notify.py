"""Parse Korean card / pay payment notifications into a provisional transaction.

Formats differ per issuer and change often, so this is deliberately tolerant: amount is the
first "N원" not labelled 누적/잔액/한도, the date is "MM/DD HH:MM" (or now), and the merchant
is what's left once the known noise is stripped. Anything without an amount is ignored.
"""

import re
from dataclasses import dataclass
from datetime import datetime

from app.engine.classify import infer_issuer

_AMOUNT = re.compile(r"(누적|잔액|한도|잔여|포인트|적립|총)?\s*:?\s*(-?[\d,]{1,12})\s*원")
_MD_HM = re.compile(r"(\d{1,2})[/.](\d{1,2})\s+(\d{1,2}):(\d{2})")
_HM = re.compile(r"\b(\d{1,2}):(\d{2})\b")
_KO_DATE = re.compile(r"(\d{1,2})월\s*(\d{1,2})일")
_NOISE = re.compile(
    r"\[?web발신\]?|\[[^\]]*\]|승인|결제|일시불|\d+개월|할부|체크|신용|사용|"
    r"[가-힣]\*[가-힣]{0,2}님?|누적[^\n]*|잔액[^\n]*|[\d,]+\s*원|\d{1,2}[/.]\d{1,2}|\d{1,2}:\d{2}|"
    r"(삼성|현대|신한|kb국민|국민|롯데|하나|우리|bc|비씨|nh|농협|씨티)\s*(카드)?|카드|"
    r"카카오페이|네이버페이|토스페이|페이코",
    re.IGNORECASE,
)
_SKIP = re.compile(r"광고|이벤트|혜택|안내|명세서|청구|결제예정|납부|이용대금|포인트\s*적립", re.IGNORECASE)
_PAY_APPS = {
    "kakaopay": "카카오페이", "카카오페이": "카카오페이",
    "naverpay": "네이버페이", "네이버페이": "네이버페이",
    "toss": "토스", "토스": "토스", "payco": "페이코", "페이코": "페이코",
}


@dataclass
class Parsed:
    amount: int  # signed, negative = spending
    occurred_at: datetime
    merchant: str
    issuer: str | None  # card company, or a pay brand for wallet payments
    cancelled: bool
    installment: int | None


def _pay_brand(blob: str) -> str | None:
    low = blob.lower()
    for key, brand in _PAY_APPS.items():
        if key in low:
            return brand
    return None


def parse(app: str, title: str, text: str, now: datetime | None = None) -> Parsed | None:
    now = now or datetime.now()
    body = " ".join(f"{title} {text}".split())
    if not body or _SKIP.search(body) and "승인" not in body:
        return None

    amount = None
    for m in _AMOUNT.finditer(body):
        if m.group(1):
            continue
        v = int(m.group(2).replace(",", "") or 0)
        if v:
            amount = abs(v)
            break
    if amount is None:
        return None

    when = now
    if m := _MD_HM.search(body):
        mo, d, h, mi = map(int, m.groups())
        try:
            when = now.replace(month=mo, day=d, hour=h, minute=mi, second=0, microsecond=0)
            if when > now.replace(hour=23, minute=59):  # December payment notified in January
                when = when.replace(year=now.year - 1)
        except ValueError:
            when = now
    elif m := _KO_DATE.search(body):
        try:
            when = now.replace(month=int(m.group(1)), day=int(m.group(2)))
        except ValueError:
            when = now
        if hm := _HM.search(body):
            when = when.replace(hour=int(hm.group(1)), minute=int(hm.group(2)), second=0, microsecond=0)

    cancelled = "취소" in body
    inst = None
    if im := re.search(r"(\d+)개월", body):
        inst = int(im.group(1))

    merchant = ""
    if tm := _MD_HM.search(text) or _HM.search(text):
        tail = re.split(r"누적|잔액|한도", text[tm.end():])[0]
        merchant = " ".join(_NOISE.sub(" ", tail).split())
    if not merchant:
        merchant = " ".join(_NOISE.sub(" ", re.sub("취소", " ", text)).split())
    merchant = merchant.strip(" -:/|·")[:60] or title.strip()[:60] or "알림 결제"

    blob = f"{app} {title} {text}"
    issuer = infer_issuer(f"{app} {title}") or _pay_brand(blob) or infer_issuer(text)
    return Parsed(
        amount=amount if cancelled else -amount,
        occurred_at=when,
        merchant=merchant,
        issuer=issuer,
        cancelled=cancelled,
        installment=inst,
    )
