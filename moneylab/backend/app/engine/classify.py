"""Turn a Banksalad row into (kind, category). Pure functions — the pipeline feeds them."""

import re
from dataclasses import dataclass

from app.engine.categories import refine
from app.engine.defaults import CAT_MAP, INCOME_MAP, SUB_MAP

CARD_COMPANY = re.compile(
    r"(삼성|현대|신한|kb국민|국민|롯데|하나|우리|bc|비씨|nh농협|농협|씨티)\s*카드", re.IGNORECASE
)
# Brokerages: money sent here is investing, not spending or a plain transfer.
SECURITIES = re.compile(
    r"증권|키움|미래에셋|한국투자|nh투자|db금융투자|이베스트투자|하이투자|신한투자|한화투자",
    re.IGNORECASE,
)

NON_SPENDING_CATEGORY = {
    "transfer": "이체", "card_payment": "카드대금", "savings": "저축", "invest": "투자", "claim": "정산",
}

# Korean names plus the words in Android app package ids (kr.co.samsungcard…, com.hyundaicard…).
_ISSUER_KEYS = [
    ("삼성", ("삼성", "samsungcard")),
    ("현대", ("현대", "hyundaicard")),
    ("신한", ("신한", "shinhancard")),
    ("KB국민", ("국민", "kbcard", "kb카드", "kb pay")),
    ("롯데", ("롯데", "lottecard")),
    ("하나", ("하나", "hanacard")),
    ("우리", ("우리", "wooricard")),
    ("BC", ("bc카드", "비씨", "bccard", "paybooc")),
    ("NH농협", ("농협", "nhcard", "nh카드")),
    ("씨티", ("씨티", "citi")),
    ("카카오뱅크", ("카카오뱅크", "kakaobank")),
]


def infer_account_kind(name: str) -> str:
    n = name.lower()
    if "간편결제" in n or "머니" in n or "포인트" in n or "페이" in n:
        return "pay"
    if "체크" in n:
        return "check_card"
    if "카드" in n:
        return "card"
    if any(k in n for k in ("적금", "도약", "청약", "희망", "정기예금")):
        return "savings"
    if any(k in n for k in ("isa", "증권", "위탁", "cma", "연금", "irp", "종합매매")):
        return "invest"
    if any(k in n for k in ("통장", "계좌", "예금")):
        return "bank"
    return "other"


def infer_issuer(text: str) -> str | None:
    """Card company named in an account name, a bank memo or a notification."""
    n = text.lower()
    for issuer, keys in _ISSUER_KEYS:
        if any(k in n for k in keys):
            return issuer
    return None


def auto_kind(src_type: str, merchant: str, account_kind: str) -> str:
    if account_kind == "savings":
        return "savings"
    if account_kind == "invest":
        return "invest"
    # Banksalad labels bill payments inconsistently (이체/카드대금, 지출/금융/카드, 지출/증권/투자 …)
    # and sometimes tags plain transfers to people as 카드대금, so go by the counterparty:
    # on a bank account, money to/from a card company is the bill.
    if account_kind in ("bank", "other") and CARD_COMPANY.search(merchant):
        return "card_payment"
    if account_kind in ("bank", "other", "pay") and SECURITIES.search(merchant):
        return "invest"
    if src_type == "이체":
        return "transfer"
    if src_type == "수입":
        return "income"
    return "expense"


def auto_category(kind: str, src_cat: str, src_sub: str, merchant: str) -> str:
    """merchant: the merchant text, plus my own title for the row when there is one."""
    if kind == "income":
        return INCOME_MAP.get(src_cat, "기타수입")
    if kind != "expense":
        return NON_SPENDING_CATEGORY[kind]
    if merchant.startswith("송금 내역"):  # 카카오페이 머니 송금: who/what is unknown
        return "미분류"
    coarse = SUB_MAP.get((src_cat, src_sub)) or CAT_MAP.get(src_cat) or "미분류"
    return refine(coarse, src_cat, src_sub, merchant)


@dataclass
class CompiledRule:
    id: int
    regex: re.Pattern
    account_kind: str | None
    set_category: str | None
    set_kind: str | None


def compile_rule(rule_id: int, pattern: str, account_kind: str | None,
                 set_category: str | None, set_kind: str | None) -> CompiledRule | None:
    try:
        regex = re.compile(pattern, re.IGNORECASE)
    except re.error:
        return None
    return CompiledRule(rule_id, regex, account_kind, set_category, set_kind)


def match_rule(rules: list[CompiledRule], merchant: str, account_kind: str,
               kind: str) -> CompiledRule | None:
    """First matching rule. Category-only rules touch spending rows only."""
    for r in rules:
        if r.account_kind and r.account_kind != account_kind:
            continue
        if not r.set_kind and kind != "expense":
            continue
        if r.regex.search(merchant):
            return r
    return None
