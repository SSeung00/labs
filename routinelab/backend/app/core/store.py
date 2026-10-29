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


# ---------- app settings ----------

SETTINGS_KEY = "settings"

DEFAULT_SETTINGS: dict[str, Any] = {
    "green_at": 0.6,  # share of the day's routines that turns the light green
    "yellow_at": 0.3,
    "day_start_hour": 4,  # a "자기 전" check at 1 am still belongs to the previous day
    "morning_on": True,
    "morning_time": "07:30",
    "review_on": True,
    "review_time": "22:00",
    "weekend_quiet": False,  # no morning/review notifications on Sat/Sun
    "celebrate": True,
    "questions": ["오늘 가장 잘한 일은?", "아쉬웠던 점은?", "내일 꼭 할 한 가지는?"],
    "onboarded": False,
}

_LIMITS = {"green_at": (0.3, 1.0), "yellow_at": (0.0, 0.9), "day_start_hour": (0, 8)}


def settings(session: Session) -> dict[str, Any]:
    stored = get(session, SETTINGS_KEY, {}) or {}
    return {**DEFAULT_SETTINGS, **{k: v for k, v in stored.items() if k in DEFAULT_SETTINGS}}


def update_settings(session: Session, changes: dict[str, Any]) -> dict[str, Any]:
    s = settings(session)
    for k, v in changes.items():
        if k not in DEFAULT_SETTINGS:
            continue
        if k in _LIMITS:
            lo, hi = _LIMITS[k]
            v = max(lo, min(hi, type(DEFAULT_SETTINGS[k])(v)))
        elif k in ("morning_time", "review_time"):
            v = _hhmm(v)
        elif k == "questions":
            v = [str(q).strip()[:120] for q in v if str(q).strip()][:8]
        elif isinstance(DEFAULT_SETTINGS[k], bool):
            v = bool(v)
        s[k] = v
    s["yellow_at"] = min(s["yellow_at"], s["green_at"])
    put(session, SETTINGS_KEY, s)
    return s


def _hhmm(v: Any) -> str:
    h, _, m = str(v).partition(":")
    if not (h.isdigit() and m.isdigit() and 0 <= int(h) < 24 and 0 <= int(m) < 60):
        raise ValueError("시간은 HH:MM 형식으로 적어 주세요.")
    return f"{int(h):02d}:{int(m):02d}"
