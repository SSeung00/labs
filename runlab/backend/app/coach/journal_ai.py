"""Free-text check-in → structured journal values + injuries (a preview; the UI saves after review)."""

from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any

from sqlmodel import Session, col, select

from app.analytics.journal import values_for_day
from app.coach.llm import CoachError, as_json_block, call, text_of
from app.models import CustomMetricDef

WEEKDAYS = "월화수목금토일"

SCALE_HINTS: dict[str, tuple[str, str]] = {
    "sleep_quality": ("나쁨", "아주 좋음"),
    "fatigue": ("개운함", "매우 피곤"),
    "soreness": ("없음", "심함"),
    "mood": ("처짐", "최고"),
    "stress": ("편안", "매우 높음"),
}

SYSTEM = """러너가 자유롭게 쓴 하루 컨디션 메모를 일지 입력 칸에 맞게 정리하세요.

규칙:
- 메모에 실제로 나온 내용만 채우세요. 언급되지 않은 항목은 values에 넣지 마세요. 추측 금지.
- 척도(scale) 항목은 min~max 정수로 바꾸세요. low/high는 양 끝의 뜻입니다. 애매하면 중간값 근처로 보수적으로.
- 숫자 항목은 단위를 맞추세요 (예: "6시간 반" → 6.5).
- 통증·부상이 언급되면 injuries에 넣으세요. body_part는 주어진 목록에서 가장 가까운 것을 고르고, \
좌우가 없으면 side는 "center"로. severity는 1(살짝 신경 쓰임)~5(달리기 불가).
- 그 밖의 내용(식사, 일정, 기분 설명 등)은 메모(text) 항목에 짧게 요약해 넣으세요. 메모 항목이 없으면 생략.
- day는 기록할 날짜(YYYY-MM-DD). 기본은 오늘. 수면은 '일어난 날'에 기록합니다: "어제 7시간 잤다", "지난밤 잘 잤다"는 오늘 아침에 깬 것이므로 오늘입니다. 메모 전체가 분명히 지난날의 일만 말할 때만 ("그저께 회식했고 그날 컨디션 최악") 그 날짜로 하세요.
- summary는 무엇을 채웠는지 한국어 한 문장. 해석이 애매했던 부분은 unclear에."""


def _schema(keys: list[str], parts: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {
            "day": {"type": "string"},
            "values": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string", "enum": keys},
                        "number": {"type": ["number", "null"]},
                        "text": {"type": ["string", "null"]},
                    },
                    "required": ["key", "number", "text"],
                    "additionalProperties": False,
                },
            },
            "injuries": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "body_part": {"type": "string", "enum": parts},
                        "side": {"type": "string", "enum": ["left", "right", "center"]},
                        "severity": {"type": "integer"},
                        "note": {"type": "string"},
                    },
                    "required": ["body_part", "side", "severity", "note"],
                    "additionalProperties": False,
                },
            },
            "summary": {"type": "string"},
            "unclear": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["day", "values", "injuries", "summary", "unclear"],
        "additionalProperties": False,
    }


def parse(session: Session, text: str, injury_parts: list[str], today: date | None = None,
          client: Any | None = None) -> dict:
    text = text.strip()
    if not text:
        raise CoachError("메모를 입력해 주세요.")
    if len(text) > 2000:
        raise CoachError("메모가 너무 길어요 (2,000자 이내).")
    today = today or date.today()
    defs = session.exec(
        select(CustomMetricDef).where(CustomMetricDef.archived.is_(False)).order_by(col(CustomMetricDef.sort_order))
    ).all()
    fields = []
    for d in defs:
        f: dict[str, Any] = {"key": d.key, "label": d.label, "kind": d.kind}
        if d.unit:
            f["unit"] = d.unit
        if d.kind == "scale":
            f["min"], f["max"] = int(d.scale_min or 1), int(d.scale_max or 5)
            if d.key in SCALE_HINTS:
                f["low"], f["high"] = SCALE_HINTS[d.key]
        if d.kind == "select" and d.options:
            f["options"] = d.options
        if d.kind == "bool":
            f["note"] = "1=예, 0=아니오"
        fields.append(f)
    parts = injury_parts or ["기타"]
    ctx = {
        "today": f"{today.isoformat()} ({WEEKDAYS[today.weekday()]})",
        "fields": fields,
        "injury_body_parts": parts,
        "memo": text,
    }
    response = call(
        session, "journal", client=client, max_tokens=4000,
        system=SYSTEM,
        output_format=_schema([d.key for d in defs], parts),
        messages=[{"role": "user", "content": as_json_block("정리할 메모와 입력 칸:", ctx)}],
    )
    try:
        out = json.loads(text_of(response))
    except json.JSONDecodeError as e:
        raise CoachError("응답을 해석하지 못했어요. 다시 시도해 주세요.") from e
    return _validate(out, {d.key: d for d in defs}, set(parts), today, session)


def _validate(out: dict, defs: dict[str, CustomMetricDef], parts: set[str], today: date, session: Session) -> dict:
    try:
        day = date.fromisoformat(out.get("day") or today.isoformat())
    except ValueError:
        day = today
    if not (today - timedelta(days=14) <= day <= today):
        day = today
    values: dict[str, Any] = {}
    for v in out.get("values", []):
        d = defs.get(v.get("key"))
        if not d:
            continue
        if d.kind in ("text", "select"):
            if v.get("text"):
                if d.kind == "select" and d.options and v["text"] not in d.options:
                    continue
                values[d.key] = v["text"].strip()
        elif v.get("number") is not None:
            n = float(v["number"])
            if d.kind == "scale":
                n = float(min(max(round(n), d.scale_min or 1), d.scale_max or 5))
            elif d.kind == "bool":
                n = 1.0 if n else 0.0
            values[d.key] = n
    injuries = [
        {**i, "severity": int(min(max(i.get("severity", 2), 1), 5))}
        for i in out.get("injuries", []) if i.get("body_part") in parts
    ]
    return {
        "day": day.isoformat(),
        "values": values,
        "current": values_for_day(session, day),
        "injuries": injuries,
        "summary": out.get("summary", ""),
        "unclear": out.get("unclear", []),
    }
