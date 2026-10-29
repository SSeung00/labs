"""Category suggestions for rows we can't classify, via the Claude API.

Only merchant text, amount, date, account type and Banksalad's own label are sent — no
names of people, no balances. Suggestions are stored on the rows and shown in 확인하기;
nothing is applied without a tap. Inert without Anthropic credentials (ANTHROPIC_API_KEY in
backend/.env, or an `ant auth login` profile), same as RunLab's coach.
"""

from __future__ import annotations

import json

import anthropic
from sqlmodel import Session, col, select

from app.engine.claude import FAST_MODEL as MODEL
from app.engine.claude import AIError, client_or_error, create, credentials_available, text_of
from app.engine.pipeline import VAGUE_CATEGORIES
from app.models import Account, Category, Txn

__all__ = ["MODEL", "AIError", "candidates", "credentials_available", "suggest"]

BATCH = 80
UNKNOWN = "모름"

SYSTEM = """당신은 한국 카드·간편결제 내역을 분류하는 도우미입니다.
각 거래의 가맹점 이름(카드 명세서 표기), 금액, 날짜, 결제수단 종류, 뱅크샐러드가 붙인 분류를 보고
주어진 카테고리 목록 중 하나를 고르세요.

- 가맹점 이름으로 업종을 알 수 있을 때만 카테고리를 고르세요.
- 이니시스, NICE, KCP, 토스페이먼츠처럼 결제대행사 이름만 있어서 무엇을 샀는지 알 수 없으면 "모름"을 고르세요.
- 사용자는 러닝(마라톤 대회, 러닝 용품)과 카메라(카메라·렌즈·사진 장비), 여행(항공·숙박·해외 결제)에 돈을 쓰는 편입니다. 근거가 있을 때만 이 카테고리를 고르세요.
- reason은 판단 근거를 20자 안팎의 한국어로 쓰세요."""


def candidates(session: Session) -> list[Txn]:
    return list(session.exec(
        select(Txn).where(
            Txn.kind == "expense", col(Txn.category).in_(VAGUE_CATEGORIES), col(Txn.dup_of_id).is_(None),
            Txn.reviewed == False, Txn.category_locked == False, col(Txn.ai_category).is_(None),
        ).order_by(col(Txn.occurred_at).desc())
    ).all())


def _schema(categories: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "integer"},
                        "category": {"type": "string", "enum": [*categories, UNKNOWN]},
                        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                        "reason": {"type": "string"},
                    },
                    "required": ["key", "category", "confidence", "reason"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["items"],
        "additionalProperties": False,
    }


def suggest(session: Session, client: anthropic.Anthropic | None = None) -> dict:
    rows = candidates(session)
    if not rows:
        return {"asked": 0, "suggested": 0}

    # One question per distinct merchant; the answer applies to all its rows.
    by_merchant: dict[str, list[Txn]] = {}
    for t in rows:
        by_merchant.setdefault(t.merchant, []).append(t)
    merchants = list(by_merchant)[:BATCH]
    kinds = {a.id: a.kind for a in session.exec(select(Account)).all()}
    cats = [c.name for c in session.exec(select(Category).order_by(Category.sort)).all() if c.group != "수입"]
    items = []
    for i, m in enumerate(merchants):
        t = by_merchant[m][0]
        items.append({
            "key": i, "merchant": m, "amount": -t.amount, "date": t.occurred_at.date().isoformat(),
            "count": len(by_merchant[m]), "payment": kinds.get(t.account_id),
            "banksalad": " > ".join(x for x in (t.src_cat, t.src_sub) if x and x != "미분류"),
        })

    client = client_or_error(client)
    response = create(
        client,
        model=MODEL,
        max_tokens=16000,
        system=SYSTEM,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": _schema(cats)}},
        messages=[{
            "role": "user",
            "content": "카테고리: " + ", ".join(cats) + "\n\n거래:\n```json\n"
            + json.dumps(items, ensure_ascii=False) + "\n```",
        }],
    )
    text = text_of(response)
    try:
        answers = json.loads(text)["items"]
    except (json.JSONDecodeError, KeyError, TypeError) as e:
        raise AIError("응답을 읽지 못했어요.") from e

    suggested = 0
    for a in answers:
        key = a.get("key")
        if not isinstance(key, int) or not 0 <= key < len(merchants):
            continue
        cat = a.get("category")
        conf = a.get("confidence", "low")
        reason = str(a.get("reason", ""))[:60]
        for t in by_merchant[merchants[key]]:
            # Keep "모름" too, so the same merchant isn't asked about again.
            t.ai_category = cat if cat in cats else UNKNOWN
            t.ai_reason = f"{conf}|{reason}"
            session.add(t)
        if cat in cats:
            suggested += 1
    session.commit()
    return {
        "asked": len(merchants),
        "suggested": suggested,
        "model": response.model,
        "remaining": max(0, len(by_merchant) - len(merchants)),
    }
