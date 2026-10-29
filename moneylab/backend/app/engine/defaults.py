"""Seed data: categories, Banksalad → MoneyLab category mapping, and starter rules."""

from datetime import datetime

from sqlmodel import Session, select

from app.engine.categories import rows as categories_rows
from app.models import Category, Rule

# The category tree lives in engine.categories; Banksalad's labels below map to coarse names
# that categories.refine narrows down to a 소분류.
CATEGORIES = categories_rows()

# Banksalad 대분류 → ours. (대분류, 소분류) overrides come first.
SUB_MAP: dict[tuple[str, str], str] = {
    ("온라인쇼핑", "서비스구독"): "구독",
    ("온라인쇼핑", "앱스토어"): "구독",
    ("온라인쇼핑", "결제/충전"): "기타",
    ("금융", "보험"): "보험",
    ("금융", "세금/과태료"): "세금/공과금",
    ("의료/건강", "운동"): "문화/여가",
}
CAT_MAP: dict[str, str] = {
    "여행/숙박": "여행",
    "식비": "식비",
    "카페/간식": "카페/간식",
    "술/유흥": "술/유흥",
    "교통": "교통",
    "자동차": "자동차",
    "온라인쇼핑": "쇼핑",
    "패션/쇼핑": "쇼핑",
    "생활": "생활",
    "주거/통신": "주거/통신",
    "문화/여가": "문화/여가",
    "의료/건강": "의료/건강",
    "뷰티/미용": "뷰티/미용",
    "교육/학습": "교육",
    "경조/선물": "경조/선물",
    "금융": "미분류",  # 은행·카드·증권 via a PG: what was bought is unknown
}
INCOME_MAP: dict[str, str] = {"급여": "급여", "금융수입": "금융수입"}

# Starter rules — editable in 설정 → 규칙. Matched case-insensitively against the merchant text.
_RUNNING = [
    "마라톤", "marathon", "러닝", "런닝", "런앤런", "가민", "garmin", "코블스포츠", "생활체육연맹",
    "육상연맹", "트레일러닝", "아식스", "asics", "호카", "hoka", "써코니", "saucony", "globalpix",
    "러너스", "runners",
]
_CAMERA = [
    "카메라", "camera", "니콘", "nikon", "캐논", "canon", "후지필름", "fujifilm", "라이카", "leica",
    "시그마", "sigma", "탐론", "tamron", "소니스토어", "sony ?store", r"\bdji\b", "올림푸스",
    "파나소닉", "lumix", "인스탁스", "instax", "고프로", "gopro",
]
_TRAVEL = [
    "항공", "airline", "airways", "아시아나", "제주항공", "진에어", "티웨이", "에어부산", "에어서울",
    "아고다", "agoda", "부킹닷컴", r"booking\.com", "트립닷컴", r"trip\.com", "익스피디아",
    "expedia", "호텔", "hotel", "에어비앤비", "airbnb", "여행", r"\bjtb\b", "클룩", "klook",
    "마이리얼트립", "면세", "duty ?free", "떠나요닷컴", "야놀자", "여기어때", "하나투어", "모두투어",
    "노랑풍선", "travel", "리조트", "resort", "airport", "공항", "이심", "esim", "로밍",
]
_SUBSCRIPTION = [
    "anthropic", "claude", "openai", "chatgpt", "netflix", "넷플릭스", "youtube", "유튜브",
    "spotify", "멤버십", "membership", "icloud", r"apple\.com", "notion", "cursor", "github",
    "typesafe",
]

RULES: list[tuple[str, int, str, str | None, str | None]] = [
    # (name, priority, pattern, set_category, set_kind)
    ("예금 이자", 5, r"^\d{2}\.\d{2}~\d{2}\.\d{2}$|결산이자|통장 이자", "금융수입", "income"),
    ("러닝", 10, "|".join(_RUNNING), "러닝", None),
    ("카메라", 20, "|".join(_CAMERA), "카메라", None),
    ("여행 예약", 30, "|".join(_TRAVEL), "숙소", None),
    ("구독 서비스", 50, "|".join(_SUBSCRIPTION), "구독", None),
]


def seed_defaults(session: Session) -> None:
    have = {c.name: c for c in session.exec(select(Category)).all()}
    for name, group, color, parent, sort in CATEGORIES:
        c = have.get(name) or Category(name=name, group=group, color=color)
        c.group, c.parent, c.sort = group, parent, sort
        if name not in have:
            c.color = color
        session.add(c)
    if not session.exec(select(Rule).where(Rule.builtin == True)).first():
        now = datetime.now()
        for name, prio, pattern, cat, kind in RULES:
            session.add(
                Rule(
                    name=name, priority=prio, pattern=pattern, set_category=cat, set_kind=kind,
                    builtin=True, created_at=now,
                )
            )
    session.commit()
