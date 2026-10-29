"""End-to-end API flows with the fake Claude client (no network, no GPU)."""

import time
from datetime import date, timedelta

from sqlmodel import Session

from app.core import speech
from app.db import engine
from app.learn import lexicon, placement, progress
from app.models import DayRecord
from tests.conftest import OVERRIDES


def test_health_and_profile(client):
    assert client.get("/api/health").json()["status"] == "ok"
    p = client.get("/api/profile").json()
    assert p["profile"]["daily_minutes"] == 180
    r = client.put("/api/profile", json={"changes": {"daily_goal_minutes": 90, "interests": ["running", " "]}})
    assert r.json()["profile"]["interests"] == ["running"]


def test_reading_flow(client, fake_ai, monkeypatch):
    text = "The old bridge over the river was built in 1932 by a small team of engineers. " * 5
    r = client.post("/api/readings", json={"source_kind": "text", "text": text, "mode": "adapt"})
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    assert r.json()["body"].startswith("The bridge")
    assert fake_ai.calls[-1]["model"] == "claude-opus-5-5"
    g = client.post("/api/gloss", json={"term": "cables", "sentence": "Engineers checked the cables."})
    assert g.status_code == 200 and "meaning_ko" in g.json()
    n = len(fake_ai.calls)
    client.post("/api/gloss", json={"term": "cables", "sentence": "Engineers checked the cables."})
    assert len(fake_ai.calls) == n  # cached
    f = client.post(f"/api/readings/{rid}/finish", json={"minutes": 12, "answers": [1, 1, 0], "known": ["cable"]})
    assert f.status_code == 200
    assert f.json()["quiz_score"] == 2 / 3
    today = client.get("/api/today").json()
    read = next(b for b in today["blocks"] if b["key"] == "read")
    assert read["done"] == 12
    assert today["streak"]["current"] == 1


def test_cards_and_review(client):
    c = client.post("/api/cards", json={"term": "take for granted", "context": "We take clean water for granted."}).json()
    assert c["kind"] == "phrase"
    q = client.get("/api/cards/queue").json()
    assert any(x["id"] == c["id"] for x in q["cards"])
    g = client.post(f"/api/cards/{c['id']}/grade", json={"rating": 3})
    assert g.status_code == 200
    again = client.post("/api/cards", json={"term": "Take for granted"}).json()
    assert again["id"] == c["id"]  # duplicate returns existing card


def test_talk_flow(client, fake_ai):
    s = client.post("/api/talk", json={"scenario": "hotel"}).json()
    cid = s["conversation"]["id"]
    assert s["message"]["role"] == "assistant"
    assert fake_ai.calls[-1]["model"] == "claude-sonnet-5-5"
    OVERRIDES["corrections"] = [{"original": "I go yesterday", "better": "I went yesterday", "type": "grammar", "note_ko": "과거"}]
    t = client.post(f"/api/talk/{cid}/turn", data={"text": "Hi, I go to hotel yesterday and my room is noisy."})
    assert t.status_code == 200, t.text
    assert t.json()["user"]["data"]["corrections"][0]["better"] == "I went yesterday"
    OVERRIDES.clear()
    client.post(f"/api/talk/{cid}/turn", data={"text": "Can I change the room please?"})
    retry = client.post(f"/api/talk/{cid}/turn", data={"text": "Could I change rooms, please?", "retry": "true"})
    assert retry.status_code == 200
    full = client.get(f"/api/talk/{cid}").json()
    assert sum(1 for m in full["messages"] if m["replaced"]) == 2
    e = client.post(f"/api/talk/{cid}/end").json()
    assert e["report"] is not None
    assert e["metrics"]["turns"] == 2
    assert fake_ai.calls[-1]["model"] == "claude-opus-5-5"
    mistakes = client.get("/api/mistakes").json()
    assert mistakes and mistakes[0]["card_id"]  # error-to-drill: correction card created


def test_placement_flow(client, fake_ai):
    real = list(lexicon.lemma_ranks())[:5]
    OVERRIDES["not_real_words"] = []
    OVERRIDES["pseudowords"] = ["plinder", "frummage", "quorble"]
    pid = client.post("/api/placement").json()["id"]
    for _ in range(150):  # material is generated on a background thread
        st = client.get(f"/api/placement/{pid}").json()
        if st["status"] != "generating":
            break
        time.sleep(0.1)
    assert st["status"] == "ready", st
    vocab = st["vocab"]
    answers = {w: (w not in ("plinder", "frummage", "quorble")) for w in vocab}
    v = client.post(f"/api/placement/{pid}/vocab", json={"answers": answers}).json()
    assert v["false_alarm"] == 0 and v["estimate"] > 10000
    rd = client.post(f"/api/placement/{pid}/reading", json={"answers": [[1, 1, 1]] * 3}).json()
    assert rd["estimate"] == 5.5  # fake material: all three passages are "B1" (weight 1 each)
    client.post(f"/api/placement/{pid}/listening", json={"answers": ["dictation text"] * 3})
    client.post(f"/api/placement/{pid}/writing", json={"text": "I think online classes are useful because..."})
    OVERRIDES.clear()
    res = client.post(f"/api/placement/{pid}/finish").json()
    assert res["levels"]["reading"] == 4
    lv = client.get("/api/today").json()["levels"]
    assert lv["levels"]["reading"] == 4.0
    assert real  # list loaded


def test_word_accuracy():
    assert placement.word_accuracy("I'm gonna grab a coffee.", "i'm gonna grab a coffee") == 1.0
    assert 0.5 < placement.word_accuracy("I am going to the store", "I going to store") < 0.8


def test_streak_freeze():
    with Session(engine) as s:
        today = date.today()
        for d in (today - timedelta(days=3), today - timedelta(days=2)):
            s.merge(DayRecord(day=d))
        s.commit()
        progress.reconcile(s)
        assert s.get(DayRecord, today - timedelta(days=1)) is not None  # yesterday covered by a freeze
        st = progress.streak(s)
        assert st["current"] >= 3  # (today may already be studied by earlier tests in this DB)


def test_transcript_stats():
    tr = speech.Transcript(text="Um I went there uh last week", seconds=4, speech_seconds=3,
                           words=[{"w": "Um", "start": 0, "end": .3, "p": .9}, {"w": "I", "start": .4, "end": .5, "p": .9},
                                  {"w": "went", "start": 2, "end": 2.2, "p": .4}])
    st = tr.stats()
    assert st["fillers"] == 1 and st["long_pauses"] == 1 and st["unclear_words"] == ["went"]


def test_budget_cap(client, fake_ai):
    client.put("/api/ai/budget", json={"budget_usd": 0})
    r = client.post("/api/gloss", json={"term": "brand-new", "sentence": "a brand-new idea"})
    assert r.status_code == 400 and "예산" in r.json()["detail"]
    client.put("/api/ai/budget", json={"budget_usd": 20})


def test_cli_provider(client, monkeypatch):
    """With the provider set to cli, calls go through `claude -p` (stubbed) and cost nothing against the budget."""
    from app.core import claude_cli, llm

    seen = {}

    def fake_run(**kw):
        seen.update(kw)
        props = kw["schema"]["properties"]
        structured = ({"reply": "Welcome! Checking in?", "nudge": "", "corrections": [], "upgrade": ""} if "reply" in props
                      else {"options": [{"en": "Could I check out a bit later?", "note_ko": "정중"}]})
        return {"text": "", "structured": structured,
                "model": kw["model"], "usage": {"input_tokens": 10, "output_tokens": 5}, "equiv_usd": 0.01, "duration_s": 1}

    monkeypatch.setattr(claude_cli, "run", fake_run)
    monkeypatch.setattr(claude_cli, "status", lambda refresh=False: {"available": True, "path": "claude", "version": "x",
                                                                    "logged_in": True, "reason": None})
    monkeypatch.setattr(llm, "TEST_CLIENT", None)
    client.put("/api/ai/provider", json={"provider": "cli"})
    cid = client.post("/api/talk", json={"scenario": "hotel"})
    # talk start uses the cli path too
    assert cid.status_code == 200, cid.text
    r = client.post(f"/api/talk/{cid.json()['conversation']['id']}/help", json={"korean": "체크아웃 늦게 해도 돼요?"})
    assert r.status_code == 200 and r.json()["options"][0]["en"].startswith("Could I")
    assert seen["model"] == "claude-sonnet-5-5" and seen["effort"] == "low" and seen["schema"]
    usage = client.get("/api/ai").json()["usage"]
    assert usage["provider"] == "cli" and usage["month_usd"] >= 0 and usage["cli_month_equiv_usd"] >= 0.02
    client.put("/api/ai/provider", json={"provider": "auto"})


def test_flatten():
    from app.core.claude_cli import flatten

    assert flatten([{"role": "user", "content": "hi"}]) == "hi"
    t = flatten([{"role": "user", "content": "start"}, {"role": "assistant", "content": "Hello!"}, {"role": "user", "content": "I go home"}])
    assert "[assistant]: Hello!" in t and t.strip().endswith("Respond to the last [user] message.")


def test_placement_retry_after_error(client, fake_ai):
    from app.core import llm

    real = llm.TEST_CLIENT
    llm.TEST_CLIENT = None  # no CLI (stubbed unavailable) and no API key → generation fails
    import os
    key = os.environ.pop("ANTHROPIC_API_KEY", None)
    pid = client.post("/api/placement").json()["id"]
    for _ in range(100):
        st = client.get(f"/api/placement/{pid}").json()
        if st["status"] != "generating":
            break
        time.sleep(0.05)
    assert st["status"] == "error"
    llm.TEST_CLIENT = real
    if key:
        os.environ["ANTHROPIC_API_KEY"] = key
    OVERRIDES["not_real_words"] = []
    assert client.post(f"/api/placement/{pid}/retry").json()["status"] == "generating"
    for _ in range(150):
        st = client.get(f"/api/placement/{pid}").json()
        if st["status"] != "generating":
            break
        time.sleep(0.05)
    assert st["status"] == "ready" and st["vocab"]
    assert client.delete(f"/api/placement/{pid}").json()["ok"]


def test_failed_talk_start_leaves_nothing(client, fake_ai, monkeypatch):
    from app.core import llm
    from app.core.llm import AIError

    def boom(*a, **k):
        raise AIError("AI unavailable")

    monkeypatch.setattr(llm, "call_json", boom)
    before = len(client.get("/api/talk").json())
    r = client.post("/api/talk", json={"scenario": "hotel"})
    assert r.status_code == 400
    assert len(client.get("/api/talk").json()) == before
