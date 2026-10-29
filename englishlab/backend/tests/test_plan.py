"""Skill estimate, forecast, study plan, books, writing and pen ink (fake Claude client)."""

import time
from datetime import datetime, timedelta

from sqlmodel import Session, select

from app.db import engine
from app.learn import levels, lexicon
from app.models import Activity, LevelRecord
from tests.conftest import OVERRIDES


def _wait(client, url, done, tries=150):
    for _ in range(tries):
        data = client.get(url).json()
        if done(data):
            return data
        time.sleep(0.05)
    raise AssertionError(f"timed out waiting on {url}: {data}")


def _reset_levels():
    with Session(engine) as s:
        for r in s.exec(select(LevelRecord)).all():
            s.delete(r)
        s.commit()


def test_estimate_moves_with_evidence_and_study(client):
    _reset_levels()
    with Session(engine) as s:
        past = datetime.now() - timedelta(days=30)
        s.add(LevelRecord(created_at=past, skill="speaking", level=3.5, source="placement"))
        s.add(LevelRecord(created_at=past, skill="reading", level=4.0, source="placement"))
        s.commit()
        first = levels.estimate(s)["skills"]["speaking"]
        assert abs(first["level"] - 3.5) < 0.01
        # A month of conversation practice nudges speaking up even before new evidence…
        for i in range(1, 29):
            d = (datetime.now() - timedelta(days=i)).date()
            s.add(Activity(created_at=datetime.now(), day=d, kind="talk", minutes=60))
        s.commit()
        drifted = levels.estimate(s)["skills"]["speaking"]
        assert drifted["level"] > 3.5 and drifted["sd"] > first["sd"] - 0.2
        # …and a conversation report pulls it toward the evidence, narrowing the range.
        levels.record(s, "speaking", 4.4, "talk")
        updated = levels.estimate(s)["skills"]["speaking"]
        assert updated["level"] > drifted["level"]
        assert updated["sd"] < drifted["sd"]
        cur = levels.current(s)
        assert cur["levels"]["speaking"] == updated["level"]
        assert cur["detail"]["listening"] is None


def test_forecast_and_manual_evidence(client):
    r = client.post("/api/levels/evidence", json={"skill": "listening", "level": 4.5, "note": "TOEFL mock"})
    assert r.status_code == 200 and r.json()["levels"]["listening"] == 4.5
    f = client.get("/api/forecast").json()
    sp = f["skills"]["speaking"]
    assert sp["pace"]["at_target"] >= sp["now"]
    assert sp["pace"]["low"] <= sp["pace"]["at_target"] <= sp["pace"]["high"]
    assert f["series"]["pace"] and "speaking" in f["series"]["pace"][0]
    assert f["goal"]["reading"] == 6.0


def test_plan_book_and_today(client, fake_ai):
    OVERRIDES["level_min"] = 3.5
    OVERRIDES["level_max"] = 4.5
    b = client.post("/api/books", json={"title": "Hackers TOEFL Reading", "notes": "2026 edition"}).json()
    assert b["status"] == "researching"
    book = _wait(client, f"/api/books/{b['id']}", lambda d: d["status"] != "researching")
    assert book["status"] == "ready", book
    assert book["units"] and book["units"][0]["minutes"] >= 5
    assert any(kw.get("tools") for kw in fake_ai.calls)  # researched with web search

    a = client.post(f"/api/books/{b['id']}/activate", json={"days_per_week": 5, "minutes_per_session": 40}).json()
    assert a["status"] == "active" and a["end_date"]
    today = client.get("/api/today").json()
    blk = next(x for x in today["blocks"] if x["key"] == "book")
    assert blk["book_id"] == b["id"] and blk["target"] > 0
    read_before = next((x for x in today["blocks"] if x["key"] == "read"), {"done": 0})["done"]

    s = client.post(f"/api/books/{b['id']}/sessions", json={"minutes": 35, "units": [0], "score": 0.8}).json()
    assert s["progress"]["done"] == 1 and s["sessions"][0]["score"] == 0.8
    today = client.get("/api/today").json()
    assert next(x for x in today["blocks"] if x["key"] == "book")["done"] == 35
    read = next((x for x in today["blocks"] if x["key"] == "read"), {"done": 0})
    assert read["done"] == read_before  # book minutes count in the book block only

    p = client.post("/api/plan", json={"note": "TOEFL in April"}).json()
    assert p["status"] == "generating"
    data = _wait(client, "/api/plan", lambda d: d["plan"] is not None or d["failed"] is not None)
    assert data["plan"], data
    plan = data["plan"]
    assert plan["phases"][0]["start"] == datetime.now().date().isoformat()
    week_total = sum(plan["phases"][0]["weekly_minutes"].values())
    assert abs(week_total - 180 * 7) <= 0.15 * 180 * 7
    tr = data["track"]
    assert tr["verdict"]["state"] in ("ahead", "on_track", "slightly_behind", "behind", "none")
    assert tr["phase"]["effective_weekly"]["book"] == 200  # 5 × 40 from the active book
    assert any(blk["key"] == "book" for blk in tr["week"]["blocks"])
    assert client.get("/api/today").json()["has_plan"] is True
    c = client.post("/api/plan/checkin", json={}).json()
    assert c["text_ko"] and c["week"]
    n = len(fake_ai.calls)
    client.post("/api/plan/checkin", json={})
    assert len(fake_ai.calls) == n  # cached for the week


def test_writing_typed_and_handwritten(client, fake_ai):
    tasks = client.get("/api/writing/tasks").json()
    assert {t["key"] for t in tasks} >= {"email", "discussion"}
    pr = client.post("/api/writing/prompt", json={"task": "email"}).json()
    assert pr["prompt"]
    short = client.post("/api/writing", data={"task": "free", "text": "Too short."})
    assert short.status_code == 400
    text = "Dear Professor Kim, I am writing to ask whether I could submit my report two days late. " * 3
    OVERRIDES["level"] = 4.3
    w = client.post("/api/writing", data={"task": "email", "prompt": pr["prompt"], "text": text, "minutes": "8"}).json()
    assert w["result"]["corrected"] and w["words"] > 40
    with Session(engine) as s:
        assert s.exec(select(LevelRecord).where(LevelRecord.source == "writing")).first() is not None
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
    h = client.post("/api/writing", data={"task": "journal", "prompt": "My day", "minutes": "5"},
                    files={"image": ("ink.png", png, "image/png")})
    assert h.status_code == 200, h.text
    assert h.json()["handwritten"] is True
    blocks = fake_ai.calls[-1]["messages"][-1]["content"]
    assert blocks[0]["type"] == "image"  # API path sends the pen strokes as an image block


def test_ink_and_notes(client):
    empty = client.get("/api/ink/reading/7").json()
    assert empty["strokes"] == []
    stroke = {"id": "a", "tool": "pen", "color": 0, "size": 3, "p": 0, "w": 640, "pts": [[1, 2, 0.5], [3, 4, 0.6]]}
    client.put("/api/ink/reading/7", json={"strokes": [stroke], "highlights": [{"p": 0, "a": 2, "b": 4, "c": 0}]})
    got = client.get("/api/ink/reading/7").json()
    assert got["strokes"][0]["pts"][1] == [3, 4, 0.6] and got["highlights"][0]["b"] == 4
    n = client.post("/api/notes", json={"title": "Phrasal verbs"}).json()
    client.put(f"/api/notes/{n['id']}", json={"strokes": [stroke], "height": 2000})
    notes = client.get("/api/notes").json()
    assert any(x["id"] == n["id"] and x["stroke_count"] == 1 for x in notes)
    assert any(x["scope"] == "reading" and x["ref_id"] == 7 for x in notes)
    assert client.delete(f"/api/notes/{n['id']}").json()["ok"]


def test_quick_gloss_cached(client, fake_ai):
    text = "The cantilever truss distributes compressive loads across the abutments. " * 4
    r = client.post("/api/readings", json={"source_kind": "text", "text": text, "mode": "gloss"}).json()
    with Session(engine) as s:
        vocab = lexicon.vocab_estimate(s)
        lexicon.set_vocab_estimate(s, 500)  # so the short test text has "unknown" words
    OVERRIDES["items"] = [{"w": "bridge", "ko": "다리"}]
    q = client.post(f"/api/readings/{r['id']}/quickgloss").json()
    assert q["meanings"] == {"bridge": "다리"}
    n = len(fake_ai.calls)
    client.post(f"/api/readings/{r['id']}/quickgloss")
    assert len(fake_ai.calls) == n
    f = client.post(f"/api/readings/{r['id']}/finish", json={"minutes": 3, "answers": [1, 1, 1], "quiz_mode": "listen"})
    assert f.status_code == 200
    with Session(engine) as s:
        assert s.exec(select(LevelRecord).where(LevelRecord.source == "listening")).first() is not None
        lexicon.set_vocab_estimate(s, vocab)


def test_scheduled_book_starts_on_its_date_and_first_week_counts_from_plan_start(client, fake_ai):
    from datetime import date

    from app.learn import plan as plan_mod
    from app.models import Book, StudyPlan

    b = client.post("/api/books", json={"title": "Later Book"}).json()
    _wait(client, f"/api/books/{b['id']}", lambda d: d["status"] != "researching")
    with Session(engine) as s:
        book = s.get(Book, b["id"])
        book.status, book.start_date = "ready", date.today()
        s.add(book)
        p = plan_mod.active(s)
        assert p is not None
        p.data = {**(p.data or {}), "book_schedule": [{"book_id": book.id, "start": date.today().isoformat()}]}
        p.start = date.today()
        s.add(p)
        s.commit()
    today = client.get("/api/today").json()
    assert any(x.get("book_id") == b["id"] for x in today["blocks"])  # activated on its start date
    with Session(engine) as s:
        p = s.exec(select(StudyPlan).where(StudyPlan.active == True)).first()  # noqa: E712
        start, elapsed, span = plan_mod._week_window(p, date.today())
        assert start == date.today() and elapsed == 1 and span == 7 - date.today().weekday()
