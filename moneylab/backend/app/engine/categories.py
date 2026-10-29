"""Two-level categories: 대분류 > 소분류.

A row's category is a 소분류 (외식, 항공 …) or, when nothing finer is known or wanted, the
대분류 itself (식비). Where and why money was spent — a trip, an event — is a separate tag
(Txn.trip_id), so a dinner in Sydney is 식비 > 외식 *and* part of the 호주 trip.

`refine` turns whatever coarse label a row has (Banksalad's 대분류, a rule's category, a name
from before the split) into the most specific category the merchant text supports.
"""

import re

# 대분류: (dashboard group, color, [(소분류, color)]). Groups drive the home chart; 고정비 never
# joins a trip.
TREE: dict[str, tuple[str, str, list[tuple[str, str]]]] = {
    "식비": ("생활", "#d9480f", [("외식", "#e8590c"), ("카페·간식", "#a0522d"), ("편의점", "#f08c00"),
                              ("장보기", "#94d82d"), ("술", "#c2255c"), ("배달", "#ff922b")]),
    "교통": ("생활", "#1971c2", [("대중교통", "#1c7ed6"), ("택시", "#4dabf7"), ("기차·버스", "#3b5bdb"),
                              ("렌트·쏘카", "#5c7cfa"), ("주차·연료", "#748ffc")]),
    "숙소": ("여행", "#2a78d6", [("숙박", "#339af0")]),
    "쇼핑": ("생활", "#e64980", [("의류·신발", "#f06595"), ("전자기기", "#ae3ec9"), ("생활용품", "#2f9e44"),
                              ("온라인쇼핑", "#f783ac")]),
    "러닝": ("취미", "#e8590c", [("대회 참가비", "#fd7e14"), ("러닝 용품", "#ff8787"), ("러닝 클럽", "#ffa94d")]),
    "운동": ("취미", "#f08c00", [("클라이밍", "#fab005"), ("피트니스", "#ffd43b")]),
    "카메라": ("취미", "#9c36b5", []),
    "문화·여가": ("생활", "#7048e8", [("책", "#845ef7"), ("영화·공연", "#9775fa"), ("관광·체험", "#b197fc"),
                                ("취미·기타", "#d0bfff")]),
    "건강·미용": ("생활", "#0c8599", [("병원", "#1098ad"), ("약국", "#22b8cf"), ("미용", "#f06595")]),
    "교육": ("생활", "#5c7cfa", [("등록금", "#4263eb"), ("강의·자료", "#91a7ff")]),
    "경조·선물": ("생활", "#f59f00", [("축의·경조", "#fab005"), ("선물·기념품", "#ffd43b")]),
    "구독": ("고정비", "#4c6ef5", [("업무·AI 도구", "#364fc7"), ("엔터·생활 구독", "#748ffc")]),
    "고정 지출": ("고정비", "#495057", [("통신", "#868e96"), ("보험", "#74b816"), ("세금·공과금", "#862e9c"),
                                 ("카드·금융 수수료", "#adb5bd")]),
    "학회·행사": ("여행", "#0b7285", []),
    "기타": ("기타", "#ced4da", [("미분류", "#dee2e6")]),
    "수입": ("수입", "#2b8a3e", [("급여", "#2b8a3e"), ("과외", "#40c057"), ("용돈·지원", "#69db7c"),
                              ("금융수입", "#37b24d"), ("기타수입", "#8ce99a")]),
}
# 항공 lives under 교통 but counts toward the 여행 group.
TREE["교통"][2].append(("항공", "#2a78d6"))
GROUP_OVERRIDE = {"항공": "여행"}

PARENT: dict[str, str] = {}
for _parent, (_g, _c, _kids) in TREE.items():
    PARENT[_parent] = _parent
    for _k, _ in _kids:
        PARENT[_k] = _parent

# Bookings made ahead for a trip (they join the next trip, see engine.trips).
TRAVEL_BOOKING = {"항공", "숙소", "숙박"}


def rows() -> list[tuple[str, str, str, str | None, int]]:
    """(name, group, color, parent, sort) for every category."""
    out, sort = [], 0
    for parent, (group, color, kids) in TREE.items():
        out.append((parent, group, color, None, sort))
        sort += 1
        for name, c in kids:
            out.append((name, GROUP_OVERRIDE.get(name, group), c, parent, sort))
            sort += 1
    return out


def parent_of(name: str) -> str:
    return PARENT.get(name, name)


def family(name: str) -> set[str]:
    """A category and, for a 대분류, all of its 소분류."""
    if name in TREE:
        return {name, *(k for k, _ in TREE[name][2])}
    return {name}


def _has(pattern: str, text: str) -> bool:
    return re.search(pattern, text, re.IGNORECASE) is not None


RACE = r"마라톤|marathon|대회|접수|참가|레이스|race|하프|풀코스|\d+k\b|런(?![가-힣])|pont 3|globalpix|대학러닝리그"
AI_TOOLS = r"anthropic|claude|openai|chatgpt|cursor|adobe|microsoft|onedrive|typesafe|github|notion|구글|google|gemini"


def refine(category: str, src_cat: str = "", src_sub: str = "", text: str = "") -> str:
    """Most specific category for a row labelled `category` (old or coarse names welcome)."""
    t = text.lower()
    sub = src_sub or ""
    c = category
    if c in ("여행", "숙소"):
        if sub == "항공권" or _has(r"항공|airline|airways|virgin|qantas|jetstar|flight", t):
            return "항공"
        if sub == "숙박비" or _has(r"agoda|아고다|hotel|호텔|숙소|숙박|pod|apart|booking|airbnb|떠나요|놀러와|펜션|빌라|리조트|baronnet|k2 bris", t):
            return "숙박"
        if _has(RACE, t):
            return "대회 참가비"
        if _has(r"보험", t):
            return "보험"
        if sub == "편의점" or _has(r"cu|gs25|세븐일레븐|편의점|news travels", t):
            return "편의점"
        if _has(r"면세|duty|lotte tr|기념품|australian way", t):
            return "선물·기념품"
        return "숙소" if c == "숙소" else "관광·체험"
    if c == "러닝":
        if _has(r"달리샤|회비|클럽|모임|싱글렛|단체", t):
            return "러닝 클럽"
        if _has(RACE, t):
            return "대회 참가비"
        return "러닝 용품"
    if c == "운동":
        return "클라이밍" if _has(r"클라이밍|더월|climb", t) else "피트니스"
    if c == "식비":
        if sub == "식재료" or _has(r"마트|coles|woolworths|식재료|seafood", t):
            return "장보기"
        if sub == "배달" or _has(r"배달의민족|배민|요기요|쿠팡이츠", t):
            return "배달"
        return "외식"
    if c in ("카페/간식",):
        return "카페·간식"
    if c in ("술/유흥",):
        return "술"
    if c in ("교통", "자동차"):
        if _has(r"k2 bris", t):  # a Brisbane apartment's card hold, filed by Banksalad as 자동차
            return "숙박"
        if sub == "택시" or _has(r"uber|우버|택시|카카오t", t):
            return "택시"
        if sub in ("철도", "시외버스", "고속버스") or _has(r"ktx|철도|korail|코레일|srt|고속버스|시외버스", t):
            return "기차·버스"
        if sub == "항공권" or _has(r"항공|airline", t):
            return "항공"
        if sub == "할부/리스" or _has(r"쏘카|socar|렌터카|렌트|rent", t):
            return "렌트·쏘카"
        if sub in ("주차", "주유", "정비/수리") or _has(r"주차|parking|주유|기름|oil|park", t):
            return "주차·연료"
        return "대중교통" if c == "교통" else "주차·연료"
    if c == "쇼핑":
        if _has(r"baronnet", t):
            return "숙박"
        if _has(r"컴퓨존|전자|애플|apple|하이마트|ssd|컴퓨터|노트북|가전|아이폰|갤럭시|모니터", t):
            return "전자기기"
        if src_cat == "패션/쇼핑" or _has(r"의류|신발|옷|패션|백화점|아울렛|kokomo|무신사|유니클로", t):
            return "의류·신발"
        if _has(r"다이소|생필품|생활용품", t):
            return "생활용품"
        return "온라인쇼핑"
    if c == "생활":
        if sub == "편의점" or _has(r"편의점|씨유|cu\b|cu\(|gs25|지에스|세븐일레븐|이마트24|ministop", t):
            return "편의점"
        if sub == "마트" or _has(r"마트|coles|woolworths|홈플러스|식재료", t):
            return "장보기"
        return "생활용품"
    if c in ("문화/여가", "문화·여가"):
        if sub == "도서" or _has(r"도서|교보|책|book|시리즈|리디|yes24|알라딘", t):
            return "책"
        if sub in ("영화", "공연", "음악") or _has(r"영화|공연|cgv|메가박스|롯데시네마|유애나|콘서트|뮤지컬", t):
            return "영화·공연"
        if sub in ("테마파크", "전시/관람", "취미/체험", "스포츠") or _has(
                r"테마파크|관광|전시|박물관|museum|dreamworld|lone pine|체험|서핑|surf|cheyne|볼링|koala", t):
            return "관광·체험"
        return "취미·기타"
    if c in ("의료/건강", "건강·미용"):
        return "약국" if sub == "약국" or _has(r"약국", t) else "병원"
    if c in ("뷰티/미용",):
        return "미용"
    if c == "교육":
        return "등록금" if _has(r"등록금|서울대", t) else "강의·자료"
    if c in ("경조/선물", "경조·선물"):
        return "축의·경조" if _has(r"축의|결혼|조의|부의|경조|헌금|기부", t) else "선물·기념품"
    if c == "송금":
        return "미분류"
    if c == "구독":
        return "업무·AI 도구" if _has(AI_TOOLS, t) else "엔터·생활 구독"
    if c in ("주거/통신",):
        return "카드·금융 수수료" if _has(r"알림서비스|알림수수료", t) else "통신"
    if c in ("세금/공과금",):
        return "세금·공과금"
    if c in ("금융",):
        return "카드·금융 수수료"
    return c
