"""Shared Claude API call path: credentials, error mapping, usage logging and the budget cap.

Every AI feature goes through `call()`, so spend is metered in one place and the app stops
calling the API once the user's budget (default $20) is used up.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any

import anthropic
from sqlmodel import Session, func, select

from app.models import AiUsage, SyncState

MODEL = "claude-opus-5-5"  # the default; each feature can pick its own (see FEATURES)
BUDGET_KEY = "ai_budget_usd"
CONFIG_KEY = "ai_feature_config"
DEFAULT_BUDGET_USD = 20.0

MODELS: dict[str, str] = {
    "claude-opus-5-5": "Opus 5.5",
    "claude-sonnet-5-5": "Sonnet 5.5",
    "claude-haiku-5-5": "Haiku 5.5",
}
EFFORTS = ["low", "medium", "high", "xhigh"]

# feature -> (label, default model, default effort). Opus where the task needs multi-step
# reasoning over numbers; Haiku for filling fixed fields, where speed matters more.
FEATURES: dict[str, tuple[str, str, str]] = {
    "chat": ("AI 코치 대화", "claude-opus-5-5", "medium"),
    "activity": ("러닝 분석", "claude-opus-5-5", "medium"),
    "plan": ("계획 조정", "claude-opus-5-5", "medium"),
    "weekly": ("주간 리포트", "claude-opus-5-5", "medium"),
    "journal": ("말로 기록", "claude-haiku-5-5", "low"),
}
# Server-side refusal fallback is available for these; Haiku has none.
FALLBACK_MODELS = {"claude-opus-5-5", "claude-sonnet-5-5"}

# $/MTok: input, output, cache read. Cache writes (5 min) bill at 1.25x input.
PRICES: dict[str, tuple[float, float, float]] = {
    "claude-opus-5-5": (4.0, 20.0, 0.20),
    "claude-opus-5": (5.0, 25.0, 0.50),
    "claude-opus-4-8": (5.0, 25.0, 0.50),
    "claude-sonnet-5-5": (2.0, 10.0, 0.20),
    "claude-haiku-5-5": (0.10, 0.50, 0.01),
    "claude-fable-5-1": (10.0, 50.0, 0.25),
}
FALLBACK_PRICE = (5.0, 25.0, 0.50)  # unknown model (e.g. a refusal fallback): price conservatively


class CoachError(Exception):
    pass


def credentials_available() -> bool:
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        return True
    # `ant auth login` stores profiles here; the SDK picks them up automatically.
    return (Path.home() / ".config" / "anthropic").exists()


# ---------- budget ----------

def budget_usd(session: Session) -> float:
    row = session.get(SyncState, BUDGET_KEY)
    try:
        return float(row.value) if row and row.value else DEFAULT_BUDGET_USD
    except ValueError:
        return DEFAULT_BUDGET_USD


def set_budget_usd(session: Session, value: float) -> None:
    row = session.get(SyncState, BUDGET_KEY) or SyncState(key=BUDGET_KEY)
    row.value = f"{value:.2f}"
    row.updated_at = datetime.now()
    session.add(row)
    session.commit()


def spent_usd(session: Session) -> float:
    return float(session.exec(select(func.coalesce(func.sum(AiUsage.cost_usd), 0.0))).one())


def usage_summary(session: Session) -> dict:
    rows = session.exec(
        select(AiUsage.feature, func.count(), func.sum(AiUsage.cost_usd)).group_by(AiUsage.feature)
    ).all()
    month_start = datetime.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    month = session.exec(
        select(func.coalesce(func.sum(AiUsage.cost_usd), 0.0)).where(AiUsage.created_at >= month_start)
    ).one()
    spent = spent_usd(session)
    budget = budget_usd(session)
    return {
        "available": credentials_available(),
        "model": MODEL,
        "budget_usd": budget,
        "spent_usd": round(spent, 4),
        "remaining_usd": round(max(0.0, budget - spent), 4),
        "this_month_usd": round(float(month), 4),
        "by_feature": {f: {"calls": n, "usd": round(float(c or 0), 4)} for f, n, c in rows},
        "by_model": {
            m: {"calls": n, "usd": round(float(c or 0), 4)}
            for m, n, c in session.exec(
                select(AiUsage.model, func.count(), func.sum(AiUsage.cost_usd)).group_by(AiUsage.model)
            ).all()
        },
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
    row = session.get(SyncState, CONFIG_KEY)
    try:
        return json.loads(row.value) if row and row.value else {}
    except json.JSONDecodeError:
        return {}


def feature_config(session: Session, feature: str) -> tuple[str, str]:
    """(model, effort) for a feature: the user's choice if valid, else the default."""
    _, model, effort = FEATURES.get(feature, ("", MODEL, "medium"))
    o = _overrides(session).get(feature, {})
    if o.get("model") in MODELS:
        model = o["model"]
    if o.get("effort") in EFFORTS:
        effort = o["effort"]
    return model, effort


def set_feature_config(session: Session, feature: str, model: str | None, effort: str | None) -> None:
    """Set a feature's model/effort; None (or the default value) resets that part to the default."""
    if feature not in FEATURES:
        raise CoachError("알 수 없는 기능이에요.")
    if model is not None and model not in MODELS:
        raise CoachError("지원하지 않는 모델이에요.")
    if effort is not None and effort not in EFFORTS:
        raise CoachError("지원하지 않는 effort예요.")
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
    row = session.get(SyncState, CONFIG_KEY) or SyncState(key=CONFIG_KEY)
    row.value = json.dumps(cfg)
    row.updated_at = datetime.now()
    session.add(row)
    session.commit()


def config_view(session: Session) -> dict:
    return {
        "features": [
            {"key": k, "label": label, "model": feature_config(session, k)[0], "effort": feature_config(session, k)[1],
             "default_model": d_model, "default_effort": d_effort}
            for k, (label, d_model, d_effort) in FEATURES.items()
        ],
        "models": [{"id": m, "label": name, "input_per_mtok": PRICES[m][0], "output_per_mtok": PRICES[m][1]} for m, name in MODELS.items()],
        "efforts": EFFORTS,
    }


# ---------- the call ----------

def client_or_default(client: Any | None) -> Any:
    if client is not None:
        return client
    if not credentials_available():
        raise CoachError("Claude API 키가 없어요. backend/.env에 ANTHROPIC_API_KEY를 넣고 RunLab을 다시 시작하세요.")
    return anthropic.Anthropic()


def call(session: Session, feature: str, *, effort: str | None = None, model: str | None = None,
         client: Any | None = None, output_format: dict | None = None, max_tokens: int = 16000,
         **kwargs: Any) -> Any:
    """One Messages API request with budget check, refusal fallback, error mapping and metering.

    Model and effort come from the feature's settings; `model`/`effort` override them for one call."""
    spent, budget = spent_usd(session), budget_usd(session)
    if spent >= budget:
        raise CoachError(f"AI 예산 ${budget:.0f}을 모두 썼어요. 설정에서 예산을 늘릴 수 있어요.")
    api = client_or_default(client)
    cfg_model, cfg_effort = feature_config(session, feature)
    model = model if model in MODELS else cfg_model
    output_config: dict[str, Any] = {"effort": effort or cfg_effort}
    if output_format:
        output_config["format"] = {"type": "json_schema", "schema": output_format}
    if model in FALLBACK_MODELS:
        # If a request is declined for policy reasons, the API retries it on its default fallback.
        kwargs = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default", **kwargs}
    try:
        response = api.beta.messages.create(model=model, max_tokens=max_tokens, output_config=output_config, **kwargs)
    except anthropic.AuthenticationError as e:
        raise CoachError("API 키가 올바르지 않아요. backend/.env의 키를 확인하세요.") from e
    except anthropic.PermissionDeniedError as e:
        raise CoachError("이 API 키로는 사용할 수 없는 기능이에요.") from e
    except anthropic.RateLimitError as e:
        raise CoachError("요청 한도에 걸렸어요. 잠시 후 다시 시도하세요.") from e
    except anthropic.BadRequestError as e:
        msg = str(getattr(e, "message", "") or e)
        if "credit" in msg.lower() or "billing" in msg.lower():
            raise CoachError("API 크레딧이 부족해요. console.anthropic.com에서 확인하세요.") from e
        raise CoachError(f"요청 형식 오류: {msg[:200]}") from e
    except anthropic.APIStatusError as e:
        raise CoachError(f"Claude API 오류 ({e.status_code}). 잠시 후 다시 시도하세요.") from e
    except anthropic.APIConnectionError as e:
        raise CoachError("Claude API에 연결하지 못했어요. 인터넷 연결을 확인하세요.") from e

    usage = response.usage
    cost = cost_of(response.model, usage)
    session.add(AiUsage(
        created_at=datetime.now(), feature=feature, model=response.model,
        input_tokens=getattr(usage, "input_tokens", 0) or 0,
        output_tokens=getattr(usage, "output_tokens", 0) or 0,
        cache_read_tokens=getattr(usage, "cache_read_input_tokens", 0) or 0,
        cache_write_tokens=getattr(usage, "cache_creation_input_tokens", 0) or 0,
        cost_usd=cost,
    ))
    session.commit()

    if response.stop_reason == "refusal":
        raise CoachError("이번 요청은 처리되지 않았어요. 내용을 조금 바꿔 다시 시도해 주세요.")
    return response


def as_json_block(intro: str, data: Any) -> str:
    """Prompt text: a short intro followed by the data as a fenced JSON block."""
    return f"{intro}\n```json\n{json.dumps(data, ensure_ascii=False, default=str)}\n```"


def text_of(response: Any) -> str:
    return "".join(b.text for b in response.content if b.type == "text").strip()
