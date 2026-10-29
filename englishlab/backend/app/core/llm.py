"""Shared Claude call path: provider choice, error mapping, usage logging and the monthly budget cap.

Every AI feature goes through `call()` (or `call_json()`). Two providers:
- cli: the Claude Code CLI signed in with the user's Claude subscription (no per-call charge; it counts
  against the plan's usage limits). Default whenever the CLI is installed and logged in.
- api: the Anthropic API with a key in backend/.env; metered, and stops at this month's budget ($20).
"""

from __future__ import annotations

import base64
import json
import os
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import anthropic
from sqlmodel import Session, func, select

from app.core import claude_cli, store
from app.models import AiUsage

PROVIDER_KEY = "ai_provider"  # auto | cli | api
PROVIDERS = ("auto", "cli", "api")
BUDGET_KEY = "ai_budget_usd"
CONFIG_KEY = "ai_feature_config"
DEFAULT_BUDGET_USD = 20.0

MODELS: dict[str, str] = {
    "claude-opus-5-5": "Opus 5.5",
    "claude-sonnet-5-5": "Sonnet 5.5",
    "claude-haiku-5-5": "Haiku 5.5",
}
EFFORTS = ["low", "medium", "high", "xhigh"]

# feature -> (label, default model, default effort).
# Live conversation needs speed (Sonnet, low); judging the learner and rewriting texts needs care
# (Opus, medium); lookups and card filling are fixed-format and cheap (Haiku, low).
FEATURES: dict[str, tuple[str, str, str]] = {
    "talk": ("AI 대화 (실시간 응답)", "claude-sonnet-5-5", "low"),
    "talk_report": ("대화 리포트·교정", "claude-opus-5-5", "medium"),
    "reading": ("읽기 자료 변환", "claude-opus-5-5", "medium"),
    "placement": ("레벨 진단", "claude-opus-5-5", "medium"),
    "gloss": ("단어 탭 뜻풀이", "claude-haiku-5-5", "low"),
    "card": ("단어 카드 채우기", "claude-haiku-5-5", "low"),
    "coach": ("오늘의 코치 한마디", "claude-haiku-5-5", "low"),
    "plan": ("공부 계획 짜기", "claude-opus-5-5", "medium"),
    "book": ("교재 조사 (웹 검색)", "claude-sonnet-5-5", "medium"),
    "checkin": ("주간 계획 점검", "claude-sonnet-5-5", "low"),
    "writing": ("쓰기 첨삭 (손글씨 포함)", "claude-sonnet-5-5", "medium"),
    "quickgloss": ("읽기 단어 뜻 미리 채우기", "claude-haiku-5-5", "low"),
}
# Server-side refusal fallback ("default" routing) is available for these; Haiku has none.
FALLBACK_MODELS = {"claude-opus-5-5", "claude-sonnet-5-5"}

# $/MTok: input, output, cache read. Cache writes (5 min) bill at 1.25x input.
PRICES: dict[str, tuple[float, float, float]] = {
    "claude-opus-5-5": (4.0, 20.0, 0.20),
    "claude-opus-5": (5.0, 25.0, 0.50),
    "claude-opus-4-8": (5.0, 25.0, 0.50),
    "claude-sonnet-5-5": (2.0, 10.0, 0.20),
    "claude-sonnet-5": (2.0, 10.0, 0.20),
    "claude-haiku-5-5": (0.10, 0.50, 0.01),
    "claude-fable-5-1": (10.0, 50.0, 0.25),
}
FALLBACK_PRICE = (5.0, 25.0, 0.50)  # unknown model (e.g. a refusal fallback): price conservatively


class AIError(Exception):
    pass


def credentials_available() -> bool:
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        return True
    # `ant auth login` stores profiles here; the SDK picks them up automatically.
    return (Path.home() / ".config" / "anthropic").exists()


def provider_pref(session: Session) -> str:
    pref = store.get(session, PROVIDER_KEY, "auto")
    return pref if pref in PROVIDERS else "auto"


def set_provider(session: Session, pref: str) -> None:
    if pref not in PROVIDERS:
        raise AIError("알 수 없는 방식이에요.")
    store.put(session, PROVIDER_KEY, pref)


def provider(session: Session) -> str:
    """The provider calls will use now: the user's choice, or for 'auto' the CLI when it is ready."""
    pref = provider_pref(session)
    if pref != "auto":
        return pref
    return "cli" if claude_cli.status()["available"] else "api"


def available(session: Session) -> bool:
    return claude_cli.status()["available"] if provider(session) == "cli" else credentials_available()


# ---------- budget ----------

def budget_usd(session: Session) -> float:
    try:
        return float(store.get(session, BUDGET_KEY, DEFAULT_BUDGET_USD))
    except (TypeError, ValueError):
        return DEFAULT_BUDGET_USD


def set_budget_usd(session: Session, value: float) -> None:
    store.put(session, BUDGET_KEY, round(float(value), 2))


def _month_start() -> datetime:
    return datetime.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def month_spent_usd(session: Session) -> float:
    q = select(func.coalesce(func.sum(AiUsage.cost_usd), 0.0)).where(AiUsage.created_at >= _month_start())
    return float(session.exec(q).one())


def month_equiv_usd(session: Session) -> float:
    q = select(func.coalesce(func.sum(AiUsage.equiv_usd), 0.0)).where(
        AiUsage.created_at >= _month_start(), AiUsage.provider == "cli")
    return float(session.exec(q).one())


def usage_summary(session: Session) -> dict:
    start = _month_start()
    by_feature = session.exec(
        select(AiUsage.feature, func.count(), func.sum(AiUsage.cost_usd + AiUsage.equiv_usd))
        .where(AiUsage.created_at >= start).group_by(AiUsage.feature)
    ).all()
    total = float(session.exec(select(func.coalesce(func.sum(AiUsage.cost_usd), 0.0))).one())
    spent, budget = month_spent_usd(session), budget_usd(session)
    return {
        "available": available(session),
        "provider": provider(session),
        "provider_pref": provider_pref(session),
        "cli": claude_cli.status(),
        "api_key": credentials_available(),
        "cli_month_equiv_usd": round(month_equiv_usd(session), 4),
        "budget_usd": budget,
        "month_usd": round(spent, 4),
        "remaining_usd": round(max(0.0, budget - spent), 4),
        "all_time_usd": round(total, 4),
        "by_feature": {f: {"calls": n, "usd": round(float(c or 0), 4)} for f, n, c in by_feature},
    }


def cost_of(model: str, usage: Any) -> float:
    p_in, p_out, p_read = PRICES.get(model, FALLBACK_PRICE)
    inp = getattr(usage, "input_tokens", 0) or 0
    out = getattr(usage, "output_tokens", 0) or 0
    read = getattr(usage, "cache_read_input_tokens", 0) or 0
    write = getattr(usage, "cache_creation_input_tokens", 0) or 0
    if model == "claude-haiku-5-5" and inp + read + write > 100_000:
        p_in, p_out, p_read = 0.50, 2.50, 0.05  # long-prompt tier
    return (inp * p_in + out * p_out + read * p_read + write * p_in * 1.25) / 1_000_000


# ---------- per-feature model & effort ----------

def _overrides(session: Session) -> dict[str, dict[str, str]]:
    return store.get(session, CONFIG_KEY, {}) or {}


def feature_config(session: Session, feature: str) -> tuple[str, str]:
    """(model, effort) for a feature: the user's choice if valid, else the default."""
    _, model, effort = FEATURES.get(feature, ("", "claude-opus-5-5", "medium"))
    o = _overrides(session).get(feature, {})
    if o.get("model") in MODELS:
        model = o["model"]
    if o.get("effort") in EFFORTS:
        effort = o["effort"]
    return model, effort


def set_feature_config(session: Session, feature: str, model: str | None, effort: str | None) -> None:
    if feature not in FEATURES:
        raise AIError("알 수 없는 기능이에요.")
    if model is not None and model not in MODELS:
        raise AIError("지원하지 않는 모델이에요.")
    if effort is not None and effort not in EFFORTS:
        raise AIError("지원하지 않는 effort예요.")
    _, d_model, d_effort = FEATURES[feature]
    cfg = _overrides(session)
    entry: dict[str, str] = {}
    if model is not None and model != d_model:
        entry["model"] = model
    if effort is not None and effort != d_effort:
        entry["effort"] = effort
    if entry:
        cfg[feature] = entry
    else:
        cfg.pop(feature, None)
    store.put(session, CONFIG_KEY, cfg)


def config_view(session: Session) -> dict:
    return {
        "features": [
            {"key": k, "label": label, "model": feature_config(session, k)[0],
             "effort": feature_config(session, k)[1], "default_model": d_model, "default_effort": d_effort}
            for k, (label, d_model, d_effort) in FEATURES.items()
        ],
        "models": [{"id": m, "label": name, "input_per_mtok": PRICES[m][0], "output_per_mtok": PRICES[m][1]}
                   for m, name in MODELS.items()],
        "efforts": EFFORTS,
    }


# ---------- the call ----------

_client: anthropic.Anthropic | None = None


def client_or_default(client: Any | None) -> Any:
    global _client
    if client is not None:
        return client
    if not credentials_available():
        raise AIError("Claude API 키가 없어요. backend/.env에 ANTHROPIC_API_KEY를 넣고 EnglishLab을 다시 시작하세요.")
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


# Tests swap this for a fake client.
TEST_CLIENT: Any | None = None


def _with_images(messages: list[dict], images: list[bytes]) -> list[dict]:
    """Put the images in front of the text of the last user message (API path)."""
    last = messages[-1]
    content = last["content"] if isinstance(last["content"], list) else [{"type": "text", "text": last["content"]}]
    blocks = [{"type": "image", "source": {"type": "base64", "media_type": "image/png",
                                           "data": base64.standard_b64encode(b).decode()}} for b in images]
    return [*messages[:-1], {**last, "content": blocks + content}]


def _web_tools(model: str) -> list[dict]:
    if model == "claude-haiku-5-5":
        return [{"type": "web_search_20250305", "name": "web_search", "max_uses": 6}]
    return [{"type": "web_search_20260209", "name": "web_search", "max_uses": 6},
            {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 4}]


def call(session: Session, feature: str, *, effort: str | None = None, model: str | None = None,
         client: Any | None = None, output_format: dict | None = None, max_tokens: int = 16000,
         web: bool = False, images: list[bytes] | None = None, **kwargs: Any) -> Any:
    """One Messages API request with budget check, refusal fallback, error mapping and metering.

    Model and effort come from the feature's settings; `model`/`effort` override them for one call.
    `web` lets the model search the web (research features); `images` are PNGs sent with the last message."""
    if TEST_CLIENT is None and client is None and provider(session) == "cli":
        return _call_cli(session, feature, effort=effort, model=model, output_format=output_format, web=web,
                         images=images, **kwargs)
    spent, budget = month_spent_usd(session), budget_usd(session)
    if spent >= budget:
        raise AIError(f"이번 달 AI 예산 ${budget:.0f}을 모두 썼어요. 설정에서 예산을 늘릴 수 있어요.")
    api = client_or_default(client or TEST_CLIENT)
    cfg_model, cfg_effort = feature_config(session, feature)
    model = model if model in MODELS else cfg_model
    output_config: dict[str, Any] = {"effort": effort or cfg_effort}
    if output_format:
        output_config["format"] = {"type": "json_schema", "schema": output_format}
    if model in FALLBACK_MODELS:
        # If a request is declined for policy reasons, the API retries it on its default fallback.
        kwargs = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default", **kwargs}
    if images:
        kwargs["messages"] = _with_images(kwargs["messages"], images)
    if web:
        kwargs["tools"] = _web_tools(model)
    try:
        response = api.beta.messages.create(model=model, max_tokens=max_tokens, output_config=output_config, **kwargs)
        # A long server-tool turn can pause; send it back so the model continues (a few times at most).
        for _ in range(4):
            if getattr(response, "stop_reason", None) != "pause_turn":
                break
            _meter(session, feature, response)
            kwargs["messages"] = [*kwargs["messages"], {"role": "assistant", "content": response.content}]
            response = api.beta.messages.create(model=model, max_tokens=max_tokens, output_config=output_config,
                                                **kwargs)
    except anthropic.AuthenticationError as e:
        raise AIError("API 키가 올바르지 않아요. backend/.env의 키를 확인하세요.") from e
    except anthropic.PermissionDeniedError as e:
        raise AIError("이 API 키로는 사용할 수 없는 기능이에요.") from e
    except anthropic.NotFoundError as e:
        raise AIError(f"모델을 찾을 수 없어요: {model}") from e
    except anthropic.RateLimitError as e:
        raise AIError("요청 한도에 걸렸어요. 잠시 후 다시 시도하세요.") from e
    except anthropic.BadRequestError as e:
        msg = str(getattr(e, "message", "") or e)
        if "credit" in msg.lower() or "billing" in msg.lower():
            raise AIError("API 크레딧이 부족해요. console.anthropic.com에서 확인하세요.") from e
        raise AIError(f"요청 형식 오류: {msg[:200]}") from e
    except anthropic.APIStatusError as e:
        raise AIError(f"Claude API 오류 ({e.status_code}). 잠시 후 다시 시도하세요.") from e
    except anthropic.APIConnectionError as e:
        raise AIError("Claude API에 연결하지 못했어요. 인터넷 연결을 확인하세요.") from e

    _meter(session, feature, response)
    if response.stop_reason == "refusal":
        raise AIError("이번 요청은 처리되지 않았어요. 내용을 조금 바꿔 다시 시도해 주세요.")
    if response.stop_reason == "max_tokens":
        raise AIError("AI 응답이 너무 길어서 잘렸어요. 다시 시도해 주세요.")
    return response


def _meter(session: Session, feature: str, response: Any) -> None:
    usage = response.usage
    session.add(AiUsage(
        created_at=datetime.now(), feature=feature, model=response.model,
        input_tokens=getattr(usage, "input_tokens", 0) or 0,
        output_tokens=getattr(usage, "output_tokens", 0) or 0,
        cache_read_tokens=getattr(usage, "cache_read_input_tokens", 0) or 0,
        cache_write_tokens=getattr(usage, "cache_creation_input_tokens", 0) or 0,
        cost_usd=cost_of(response.model, usage),
    ))
    session.commit()


def _system_text(system: Any) -> str:
    if not system:
        return ""
    if isinstance(system, str):
        return system
    return "\n\n".join(b.get("text", "") for b in system if isinstance(b, dict))


def _call_cli(session: Session, feature: str, *, effort: str | None, model: str | None,
              output_format: dict | None, web: bool = False, images: list[bytes] | None = None,
              **kwargs: Any) -> Any:
    """Same contract as the API path, through `claude -p` on the subscription. Returns a response-like object."""
    cfg_model, cfg_effort = feature_config(session, feature)
    model = model if model in MODELS else cfg_model
    timeout = 120 if feature in ("talk", "gloss", "coach") else 720 if web else 420
    try:
        out = claude_cli.run(system=_system_text(kwargs.get("system")), prompt=claude_cli.flatten(kwargs["messages"]),
                             model=model, effort=effort or cfg_effort, schema=output_format, timeout_s=timeout,
                             tools=claude_cli.WEB_TOOLS if web else None, images=images)
    except claude_cli.CliError as e:
        raise AIError(str(e)) from e
    usage = out["usage"]
    session.add(AiUsage(
        created_at=datetime.now(), feature=feature, model=out["model"], provider="cli",
        input_tokens=int(usage.get("input_tokens") or 0), output_tokens=int(usage.get("output_tokens") or 0),
        cache_read_tokens=int(usage.get("cache_read_input_tokens") or 0),
        cache_write_tokens=int(usage.get("cache_creation_input_tokens") or 0),
        cost_usd=0.0, equiv_usd=out["equiv_usd"],
    ))
    session.commit()
    if output_format is not None:
        if out["structured"] is None:
            raise AIError("AI 응답 형식이 맞지 않았어요. 다시 시도해 주세요.")
        text = json.dumps(out["structured"], ensure_ascii=False)
    else:
        text = out["text"]
    return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)], model=out["model"],
                           stop_reason="end_turn", usage=None)


def text_of(response: Any) -> str:
    return "".join(b.text for b in response.content if b.type == "text").strip()


def call_json(session: Session, feature: str, schema: dict, **kwargs: Any) -> dict:
    """call() with a json_schema output format; returns the parsed object."""
    response = call(session, feature, output_format=schema, **kwargs)
    raw = text_of(response)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    # With web tools the answer can come after narration blocks; the JSON is the last text block.
    texts = [b.text for b in response.content if b.type == "text" and b.text.strip()]
    try:
        return json.loads(texts[-1] if texts else raw)
    except json.JSONDecodeError as e:
        raise AIError("AI 응답을 읽지 못했어요. 다시 시도해 주세요.") from e


def obj(properties: dict[str, Any], required: list[str] | None = None) -> dict:
    """JSON schema object helper: every property required, no extras (structured-output friendly)."""
    return {"type": "object", "properties": properties,
            "required": required if required is not None else list(properties), "additionalProperties": False}


def arr(items: dict) -> dict:
    return {"type": "array", "items": items}


STR = {"type": "string"}
NUM = {"type": "number"}
INT = {"type": "integer"}
BOOL = {"type": "boolean"}


def as_json_block(intro: str, data: Any) -> str:
    """Prompt text: a short intro followed by the data as a fenced JSON block."""
    return f"{intro}\n```json\n{json.dumps(data, ensure_ascii=False, default=str)}\n```"
