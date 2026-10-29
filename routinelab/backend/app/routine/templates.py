"""Starter routines by theme, so the first day doesn't begin with an empty list."""

THEMES: list[dict] = [
    {
        "key": "health",
        "name": "건강",
        "emoji": "💚",
        "habits": [
            {"name": "물 마시기", "emoji": "💧", "category": "health", "slot": "anytime", "kind": "count", "target": 8, "unit": "잔", "easy_name": "4잔만"},
            {"name": "영양제", "emoji": "💊", "category": "health", "slot": "morning", "kind": "check", "cue": "아침 식사 후"},
            {"name": "스트레칭", "emoji": "🧘", "category": "health", "slot": "night", "kind": "minutes", "target": 10, "unit": "분", "easy_name": "3분만"},
            {"name": "자정 전에 눕기", "emoji": "🛏️", "category": "health", "slot": "night", "kind": "check"},
        ],
    },
    {
        "key": "exercise",
        "name": "운동",
        "emoji": "🏃",
        "habits": [
            {"name": "러닝", "emoji": "🏃", "category": "exercise", "slot": "morning", "kind": "check", "schedule": "weekly", "per_week": 4, "easy_name": "20분 걷기"},
            {"name": "근력 운동", "emoji": "🏋️", "category": "exercise", "slot": "evening", "kind": "minutes", "target": 20, "unit": "분", "schedule": "days", "days": [0, 2, 4], "easy_name": "푸시업 10개"},
            {"name": "폼롤러", "emoji": "🧻", "category": "exercise", "slot": "night", "kind": "check", "easy_name": "종아리만"},
        ],
    },
    {
        "key": "study",
        "name": "공부",
        "emoji": "📚",
        "habits": [
            {"name": "영어 공부", "emoji": "🔤", "category": "study", "slot": "day", "kind": "minutes", "target": 120, "unit": "분", "easy_name": "단어 복습만"},
            {"name": "논문 읽기", "emoji": "📄", "category": "study", "slot": "day", "kind": "check", "schedule": "days", "days": [0, 1, 2, 3, 4], "easy_name": "초록만 읽기"},
            {"name": "독서", "emoji": "📖", "category": "study", "slot": "night", "kind": "minutes", "target": 20, "unit": "분", "easy_name": "5쪽만"},
        ],
    },
    {
        "key": "life",
        "name": "생활",
        "emoji": "🌅",
        "habits": [
            {"name": "7시 전에 일어나기", "emoji": "⏰", "category": "life", "slot": "morning", "kind": "check"},
            {"name": "책상 정리", "emoji": "🧹", "category": "life", "slot": "evening", "kind": "check", "easy_name": "3가지만 치우기"},
            {"name": "내일 할 일 적기", "emoji": "📝", "category": "life", "slot": "night", "kind": "check"},
        ],
    },
    {
        "key": "mind",
        "name": "마음",
        "emoji": "🌿",
        "habits": [
            {"name": "명상", "emoji": "🧠", "category": "mind", "slot": "morning", "kind": "minutes", "target": 5, "unit": "분", "easy_name": "숨 10번"},
            {"name": "감사 한 줄", "emoji": "🙏", "category": "mind", "slot": "night", "kind": "check"},
            {"name": "자기 전 폰 안 보기", "emoji": "📵", "category": "mind", "slot": "night", "kind": "check"},
        ],
    },
]

DEFAULT_MODES = [
    {"name": "기본", "emoji": "🌤️", "is_default": True},
    {"name": "주말", "emoji": "🛋️"},
    {"name": "출장·여행", "emoji": "🧳"},
]
