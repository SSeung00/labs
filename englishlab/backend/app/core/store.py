"""Key/value settings in the Setting table (JSON-encoded values)."""

import json
from datetime import datetime
from typing import Any

from sqlmodel import Session

from app.models import Setting


def get(session: Session, key: str, default: Any = None) -> Any:
    row = session.get(Setting, key)
    if not row or row.value is None:
        return default
    try:
        return json.loads(row.value)
    except json.JSONDecodeError:
        return default


def put(session: Session, key: str, value: Any, commit: bool = True) -> None:
    row = session.get(Setting, key) or Setting(key=key)
    row.value = json.dumps(value, ensure_ascii=False)
    row.updated_at = datetime.now()
    session.add(row)
    if commit:
        session.commit()


# ---------- learner profile ----------

PROFILE_KEY = "profile"

DEFAULT_PROFILE: dict[str, Any] = {
    "name": "",
    "goal": "Communicate confidently abroad and watch Netflix without subtitles (early C2); TOEFL iBT band 6.",
    "target_date": "2027-03-01",
    "daily_minutes": 180,  # study time the learner plans per day
    "daily_goal_minutes": 120,  # the ring on 오늘; lower than the plan so it is reachable on busy days
    "interests": ["civil engineering research", "running", "travel", "photography"],
    "self_level": "B1-B2",
    "voice": "en-US-AvaMultilingualNeural",
    "tts_rate": 0,  # percent, -50..+50
    "new_cards_per_day": 20,
    "max_reviews_per_day": 250,
    "auto_mistake_cards": True,
    "hide_ai_text": False,  # listening practice: AI replies are heard first, text revealed on tap
    "onboarded": False,
}


def profile(session: Session) -> dict[str, Any]:
    stored = get(session, PROFILE_KEY, {}) or {}
    return {**DEFAULT_PROFILE, **stored}


def update_profile(session: Session, changes: dict[str, Any]) -> dict[str, Any]:
    p = profile(session)
    p.update({k: v for k, v in changes.items() if k in DEFAULT_PROFILE})
    put(session, PROFILE_KEY, p)
    return p


# ---------- tutor memory ----------
# Short facts the AI tutor keeps between conversations (interests, plans, recurring problems).

MEMORY_KEY = "tutor_memory"
MEMORY_LIMIT = 40


def memory(session: Session) -> list[str]:
    return list(get(session, MEMORY_KEY, []) or [])


def remember(session: Session, facts: list[str], forget: list[str] | None = None) -> list[str]:
    current = [f for f in memory(session) if f not in set(forget or [])]
    for f in facts:
        f = f.strip()
        if f and f not in current:
            current.append(f)
    current = current[-MEMORY_LIMIT:]
    put(session, MEMORY_KEY, current)
    return current
