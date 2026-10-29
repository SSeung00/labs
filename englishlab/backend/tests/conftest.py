"""Test setup: a throwaway data dir, no Whisper, and a fake Claude client that answers any json_schema."""

import json
import os
import tempfile
from types import SimpleNamespace

os.environ["ENGLISHLAB_DATA_DIR"] = tempfile.mkdtemp(prefix="englishlab-test-")
os.environ["ENGLISHLAB_STT"] = "off"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core import llm  # noqa: E402

OVERRIDES: dict[str, object] = {}


def fake_value(schema: dict, key: str = "") -> object:
    if key in OVERRIDES:
        return OVERRIDES[key]
    t = schema.get("type")
    if "enum" in schema:
        return schema["enum"][0]
    if t == "object":
        return {k: fake_value(v, k) for k, v in schema["properties"].items()}
    if t == "array":
        n = 4 if key in ("choices",) else 3
        return [fake_value(schema["items"], key) for _ in range(n)]
    if t == "string":
        return {"body": "The bridge was built in 1932. Engineers checked the cables every year.\n\nIt still stands today.",
                "reply": "That sounds great! What did you do next?", "nudge": ""}.get(key, f"{key} text")
    if t in ("number", "integer"):
        return {"answer": 1, "level": 4.2, "seconds": 45}.get(key, 4)
    if t == "boolean":
        return False
    return None


class FakeMessages:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def create(self, **kw):
        self.calls.append(kw)
        schema = kw["output_config"]["format"]["schema"]
        text = json.dumps(fake_value(schema))
        usage = SimpleNamespace(input_tokens=1000, output_tokens=200, cache_read_input_tokens=0,
                                cache_creation_input_tokens=0)
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)], usage=usage,
                               model=kw["model"], stop_reason="end_turn")


@pytest.fixture()
def fake_ai(monkeypatch):
    from app.core import claude_cli

    # Never launch the real Claude CLI from tests.
    monkeypatch.setattr(claude_cli, "status", lambda refresh=False: {
        "available": False, "path": None, "version": None, "logged_in": False, "reason": "test"})
    msgs = FakeMessages()
    llm.TEST_CLIENT = SimpleNamespace(beta=SimpleNamespace(messages=msgs))
    OVERRIDES.clear()
    yield msgs
    llm.TEST_CLIENT = None


@pytest.fixture()
def client(fake_ai):
    from app.main import app

    with TestClient(app, base_url="http://localhost", client=("127.0.0.1", 50000)) as c:
        yield c
