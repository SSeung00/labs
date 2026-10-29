"""One place that talks to the Claude API: credentials, model choice, fallbacks, errors.

Inert unless Anthropic credentials exist (ANTHROPIC_API_KEY in backend/.env, or an
`ant auth login` profile). Max/Team plans' monthly API credits are spent through the same key.
"""

from __future__ import annotations

import os
from pathlib import Path

import anthropic

# Writing and reasoning (reports, questions) vs. bulk labelling (categories, receipts).
MODEL = os.environ.get("MONEYLAB_AI_MODEL", "claude-opus-5-5")
FAST_MODEL = os.environ.get("MONEYLAB_AI_FAST_MODEL", MODEL)

# Server-side refusal fallback ("default" routing) is only accepted by these models.
_FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"}


class AIError(Exception):
    pass


def credentials_available() -> bool:
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        return True
    return (Path.home() / ".config" / "anthropic").exists()


def client_or_error(client: anthropic.Anthropic | None = None) -> anthropic.Anthropic:
    if client is not None:
        return client
    if not credentials_available():
        raise AIError(
            "Claude API 자격 증명이 없어요. backend/.env에 ANTHROPIC_API_KEY를 넣거나 `ant auth login`을 실행하세요."
        )
    return anthropic.Anthropic()


def create(client: anthropic.Anthropic, *, model: str, **kw):
    """messages.create with fallbacks where supported and Korean error messages."""
    extra: dict = {}
    if model in _FALLBACK_MODELS:
        extra = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
    try:
        response = client.beta.messages.create(model=model, **extra, **kw)
    except anthropic.AuthenticationError as e:
        raise AIError("API 키가 올바르지 않아요.") from e
    except anthropic.PermissionDeniedError as e:
        raise AIError("이 키로는 이 모델을 쓸 수 없어요.") from e
    except anthropic.NotFoundError as e:
        raise AIError(f"모델을 찾을 수 없어요: {model}") from e
    except anthropic.RateLimitError as e:
        raise AIError("요청 한도에 걸렸어요. 잠시 후 다시 시도하세요.") from e
    except anthropic.BadRequestError as e:
        msg = str(getattr(e, "message", "")) or "요청 형식 오류"
        if "credit" in msg.lower() or "balance" in msg.lower():
            raise AIError("API 크레딧이 부족해요. Console의 결제 화면을 확인하세요.") from e
        raise AIError(f"요청이 거절됐어요: {msg[:200]}") from e
    except anthropic.APIStatusError as e:
        raise AIError(f"Claude API 오류 ({e.status_code})") from e
    except anthropic.APIConnectionError as e:
        raise AIError("Claude API에 연결하지 못했어요.") from e
    if response.stop_reason == "refusal":
        raise AIError("이번 요청은 처리되지 않았어요.")
    return response


def text_of(response) -> str:
    return "".join(b.text for b in response.content if b.type == "text").strip()


def usage_of(response) -> tuple[int, int]:
    u = getattr(response, "usage", None)
    return (getattr(u, "input_tokens", 0) or 0, getattr(u, "output_tokens", 0) or 0)
