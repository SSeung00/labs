"""AI features against a scripted fake client — no network, no spend."""

import json
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete

from app.coach import activity as activity_ai
from app.coach import chat as chat_ai
from app.coach import journal_ai, llm, plan_ai
from app.db import engine
from app.main import app
from app.models import Activity, AiUsage, Lap, Plan, PlannedWorkout


class Block(SimpleNamespace):
    def to_dict(self):
        return dict(vars(self))


def resp(blocks, stop="end_turn", inp=1000, out=200):
    return SimpleNamespace(
        stop_reason=stop, model="claude-opus-5-5", content=blocks,
        usage=SimpleNamespace(input_tokens=inp, output_tokens=out, cache_read_input_tokens=0, cache_creation_input_tokens=0),
    )


def text(t):
    return Block(type="text", text=t)


class FakeClient:
    """Returns queued responses in order and records every request."""

    def __init__(self, *responses):
        self.queue = list(responses)
        self.calls = []
        self.beta = SimpleNamespace(messages=self)

    def create(self, **kw):
        self.calls.append(json.loads(json.dumps(kw, default=str)))
        return self.queue.pop(0)


@pytest.fixture
def session():
    with TestClient(app), Session(engine) as s:
        s.exec(delete(AiUsage))
        s.commit()
        llm.set_budget_usd(s, 20)
        for f in llm.FEATURES:
            llm.set_feature_config(s, f, None, None)
        yield s


def test_cost_and_budget_cap(session):
    assert llm.cost_of("claude-opus-5-5", SimpleNamespace(input_tokens=1_000_000, output_tokens=100_000)) == pytest.approx(6.0)
    llm.call(session, "weekly", client=FakeClient(resp([text("ok")], inp=1_000_000, out=0)), messages=[])
    assert llm.spent_usd(session) == pytest.approx(4.0)
    llm.set_budget_usd(session, 4)
    with pytest.raises(llm.CoachError, match="예산"):
        llm.call(session, "weekly", client=FakeClient(), messages=[])
    summary = llm.usage_summary(session)
    assert summary["by_feature"]["weekly"]["calls"] == 1 and summary["remaining_usd"] == 0


def test_refusal_is_reported(session):
    with pytest.raises(llm.CoachError, match="처리되지 않았"):
        llm.call(session, "chat", client=FakeClient(resp([], stop="refusal")), messages=[])


def test_activity_analysis_sends_no_gps(session):
    a = Activity(name="Tempo", start_time=datetime(2026, 9, 1, 7), distance_m=10000, duration_s=2700,
                 moving_time_s=2650, avg_hr=160, start_lat=37.5, start_lon=127.0, run_type="workout")
    session.add(a)
    session.commit()
    session.add(Lap(activity_id=a.id, idx=0, distance_m=1000, duration_s=270, avg_hr=150, avg_speed_mps=1000 / 270))
    session.commit()
    fake = FakeClient(resp([text("## 한 줄 평\n- 좋아요")]))
    row = activity_ai.analyze(session, a.id, client=fake)
    assert row.markdown.startswith("## 한 줄 평") and row.cost_usd > 0
    body = fake.calls[0]["messages"][0]["content"]
    assert "37.5" not in body and "127.0" not in body and '"pace_s_per_km": 270' in body
    assert activity_ai.latest(session, a.id).id == row.id


def test_journal_parse_validates(session):
    out = {
        "day": (date.today() - timedelta(days=1)).isoformat(),
        "values": [
            {"key": "sleep_hours", "number": 6.5, "text": None},
            {"key": "fatigue", "number": 9, "text": None},  # clamped to scale max
            {"key": "nope", "number": 1, "text": None},  # unknown key dropped
            {"key": "memo", "number": None, "text": "회식"},
        ],
        "injuries": [
            {"body_part": "종아리", "side": "left", "severity": 7, "note": "땡김"},
            {"body_part": "어깨", "side": "left", "severity": 2, "note": "목록에 없음"},
        ],
        "summary": "수면·피로·종아리", "unclear": [],
    }
    fake = FakeClient(resp([text(json.dumps(out, ensure_ascii=False))]))
    r = journal_ai.parse(session, "어제 6시간 반 잤고 너무 피곤. 왼쪽 종아리 땡김. 회식", ["종아리", "무릎"], client=fake)
    assert r["values"] == {"sleep_hours": 6.5, "fatigue": 5.0, "memo": "회식"}
    assert r["injuries"] == [{"body_part": "종아리", "side": "left", "severity": 5, "note": "땡김"}]
    req = fake.calls[0]
    assert req["output_config"]["effort"] == "low" and req["output_config"]["format"]["type"] == "json_schema"
    # Default: Haiku, which has no server-side refusal fallback.
    assert req["model"] == "claude-haiku-5-5" and "fallbacks" not in req and "betas" not in req


def test_plan_propose_and_apply(session):
    today = date.today()
    session.exec(delete(PlannedWorkout))
    session.exec(delete(Plan))
    plan = Plan(name="test", start_day=today - timedelta(days=7), end_day=today + timedelta(days=60), active=True)
    session.add(plan)
    session.commit()
    ws = [
        PlannedWorkout(plan_id=plan.id, day=today + timedelta(days=1), kind="interval", title="인터벌", target_distance_m=10000,
                       structure=[{"type": "run", "distance_m": 2000, "pace": "E"}, {"type": "repeat", "reps": 5, "steps": []}]),
        PlannedWorkout(plan_id=plan.id, day=today + timedelta(days=2), kind="easy", title="이지런 8km", target_distance_m=8000,
                       structure=[{"type": "run", "distance_m": 8000, "pace": "E"}], target_tss=50),
    ]
    session.add_all(ws)
    session.commit()
    i, e = ws[0].id, ws[1].id
    out = {
        "summary": "인터벌을 하루 미루고 이지런을 줄였어요.",
        "changes": [
            {"workout_id": i, "action": "move", "new_day": (today + timedelta(days=3)).isoformat(), "new_km": None, "reason": "출장"},
            {"workout_id": e, "action": "set_distance", "new_day": None, "new_km": 5, "reason": "피로"},
            {"workout_id": i, "action": "set_distance", "new_day": None, "new_km": 5, "reason": "인터벌 거리 변경은 불가"},
            {"workout_id": 999999, "action": "skip", "new_day": None, "new_km": None, "reason": "없는 훈련"},
        ],
        "advice": "수면을 챙기세요.",
    }
    r = plan_ai.propose(session, "내일 출장", client=FakeClient(resp([text(json.dumps(out, ensure_ascii=False))])))
    assert [c["action"] for c in r["changes"]] == ["move", "set_distance"]
    assert plan_ai.apply(session, r["changes"]) == 2
    session.expire_all()
    assert session.get(PlannedWorkout, i).day == today + timedelta(days=3)
    easy = session.get(PlannedWorkout, e)
    assert easy.target_distance_m == 5000 and easy.title == "이지런 5km" and easy.target_tss == pytest.approx(31.2, abs=0.1)


def test_chat_runs_tools_and_keeps_history(session):
    tool_call = Block(type="tool_use", id="tu_1", name="weekly_summary", input={"weeks": 3})
    fake = FakeClient(
        resp([text("확인해 볼게요."), tool_call], stop="tool_use"),
        resp([text("최근 3주 평균 40km예요.")]),
        resp([text("네, 이어서요.")]),
    )
    chat = chat_ai.send(session, None, "최근 3주 거리 어때?", client=fake)
    assert [m["role"] for m in chat.messages] == ["user", "assistant", "user", "assistant"]
    result = chat.messages[2]["content"][0]
    assert result["tool_use_id"] == "tu_1" and not result["is_error"] and len(json.loads(result["content"])) == 3
    d = chat_ai.display(chat)
    assert d["items"] == [
        {"role": "user", "text": "최근 3주 거리 어때?"},
        {"role": "assistant", "text": "최근 3주 평균 40km예요.", "tools": ["주간 요약"]},
    ]
    # Follow-up replays the exact stored history (append-only).
    first_turn = json.loads(json.dumps(chat.messages, default=str))
    chat = chat_ai.send(session, chat.id, "고마워", client=fake)
    assert fake.calls[2]["messages"][:4] == first_turn
    assert len(fake.calls[2]["messages"]) == 5 and fake.calls[2]["tools"][0]["strict"] is True
    assert chat.cost_usd > 0


def test_chat_tool_errors_are_reported_not_raised(session):
    content, is_error = chat_ai._run_tool(session, "run_detail", {"activity_id": 987654})
    assert not is_error and "없어요" in content
    content, is_error = chat_ai._run_tool(session, "nope", {})
    assert is_error


def test_usage_endpoints(session):
    with TestClient(app) as c:
        assert c.put("/api/coach/budget", json={"usd": 15}).json()["budget_usd"] == 15
        assert "spent_usd" in c.get("/api/coach/usage").json()
        assert c.post("/api/coach/journal/parse", json={"text": " "}).status_code == 400


def test_feature_config_defaults_overrides_and_reset(session):
    assert llm.feature_config(session, "chat") == ("claude-opus-5-5", "medium")
    llm.set_feature_config(session, "activity", "claude-sonnet-5-5", "high")
    assert llm.feature_config(session, "activity") == ("claude-sonnet-5-5", "high")
    fake = FakeClient(resp([text("ok")]))
    llm.call(session, "activity", client=fake, messages=[])
    req = fake.calls[0]
    assert req["model"] == "claude-sonnet-5-5" and req["output_config"]["effort"] == "high"
    assert req["fallbacks"] == "default"  # Sonnet keeps the refusal fallback
    llm.set_feature_config(session, "activity", "claude-opus-5-5", "medium")  # back to defaults
    view = llm.config_view(session)
    row = next(f for f in view["features"] if f["key"] == "activity")
    assert row["model"] == row["default_model"] and row["effort"] == row["default_effort"]
    with pytest.raises(llm.CoachError):
        llm.set_feature_config(session, "activity", "gpt-x", "low")


def test_haiku_cost():
    u = SimpleNamespace(input_tokens=2000, output_tokens=500)
    assert llm.cost_of("claude-haiku-5-5", u) == pytest.approx((2000 * 0.10 + 500 * 0.50) / 1e6)


def test_chat_model_is_pinned_per_conversation(session):
    fake = FakeClient(resp([text("첫 답")]), resp([text("둘째 답")]))
    chat = chat_ai.send(session, None, "안녕", client=fake)
    assert chat.model == "claude-opus-5-5"
    llm.set_feature_config(session, "chat", "claude-sonnet-5-5", "medium")
    chat_ai.send(session, chat.id, "이어서", client=fake)
    assert fake.calls[1]["model"] == "claude-opus-5-5"  # existing conversation keeps its model


def test_config_endpoints(session):
    with TestClient(app) as c:
        body = c.get("/api/coach/config").json()
        assert {m["id"] for m in body["models"]} == {"claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"}
        r = c.put("/api/coach/config", json={"feature": "plan", "model": "claude-sonnet-5-5", "effort": "high"})
        assert next(f for f in r.json()["features"] if f["key"] == "plan")["model"] == "claude-sonnet-5-5"
        assert c.put("/api/coach/config", json={"feature": "plan", "model": "x", "effort": "high"}).status_code == 400
