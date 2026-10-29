from datetime import date, datetime, timedelta

from sqlmodel import Session, select

from app.core import scheduler
from app.db import engine
from app.models import Entry, Habit, Mode
from app.routine.book import Book, logical_today, week_start

LOCAL = {}
REMOTE = {"x-forwarded-for": "100.64.0.2", "host": "desktop.tail.ts.net:10003"}


def _today() -> date:
    return logical_today(4)


def _make(client, *habits: dict) -> list[dict]:
    r = client.post("/api/habits/bulk", json={"habits": list(habits)})
    assert r.status_code == 200, r.text
    return [h for h in r.json()["habits"] if not h["archived"]]


def _backdate(days: int) -> None:
    with Session(engine) as s:
        for h in s.exec(select(Habit)).all():
            h.start_date = _today() - timedelta(days=days)
            s.add(h)
        s.commit()


def _entry(habit_id: int, d: date, state: str = "done", value: float = 1) -> None:
    with Session(engine) as s:
        s.add(Entry(habit_id=habit_id, day=d, state=state, value=value))
        s.commit()


def test_every_template_can_be_created(client):
    themes = client.get("/api/templates").json()["themes"]
    habits = [h for t in themes for h in t["habits"]]
    created = _make(client, *habits)
    assert len(created) == len(habits)
    assert client.get("/api/settings").json()["onboarded"] is True


def test_light_counts_done_and_skips(client):
    hs = _make(client, *({"name": f"r{i}"} for i in range(5)))
    t = client.get("/api/today").json()
    assert t["signal"] == {"day": t["day"], "done": 0, "total": 5, "rate": 0.0, "color": "off"}

    for h in hs[:2]:
        t = client.put("/api/entries", json={"habit_id": h["id"], "day": t["day"], "state": "done"}).json()
    assert (t["signal"]["done"], t["signal"]["total"], t["signal"]["color"]) == (2, 5, "yellow")

    for h in hs[2:4]:
        t = client.put("/api/entries", json={"habit_id": h["id"], "day": t["day"], "state": "skip"}).json()
    assert (t["signal"]["done"], t["signal"]["total"], t["signal"]["color"]) == (2, 3, "green")
    assert t["streak"]["current"] == 1

    # Clearing an entry removes it.
    t = client.put("/api/entries", json={"habit_id": hs[0]["id"], "day": t["day"], "state": ""}).json()
    assert t["signal"]["done"] == 1
    with Session(engine) as s:
        assert s.exec(select(Entry).where(Entry.habit_id == hs[0]["id"])).first() is None


def test_quantity_and_easy_version(client):
    (h,) = _make(client, {"name": "물", "kind": "count", "target": 8, "unit": "잔", "easy_name": "4잔"})
    d = _today().isoformat()
    t = client.put("/api/entries", json={"habit_id": h["id"], "day": d, "value": 3}).json()
    assert t["habits"][0]["done"] is False and t["habits"][0]["entry"]["value"] == 3
    t = client.put("/api/entries", json={"habit_id": h["id"], "day": d, "value": 8}).json()
    assert t["habits"][0]["entry"]["state"] == "done"
    t = client.put("/api/entries", json={"habit_id": h["id"], "day": d, "value": 5}).json()
    assert t["habits"][0]["done"] is False
    t = client.put("/api/entries", json={"habit_id": h["id"], "day": d, "state": "easy"}).json()
    assert t["habits"][0]["done"] is True and t["signal"]["color"] == "green"


def test_weekly_counts_only_on_last_chance(client):
    (h,) = _make(client, {"name": "러닝", "schedule": "weekly", "per_week": 3})
    _backdate(60)
    mon = week_start(_today()) - timedelta(weeks=3)
    _entry(h["id"], mon)
    with Session(engine) as s:
        book = Book(s, mon - timedelta(days=7), _today())
        fri, sat, sun = (book.day(mon + timedelta(days=i)).by_habit[h["id"]] for i in (4, 5, 6))
    assert not fri.counted  # needs 2 more, 3 days left
    assert sat.counted and not sat.done  # needs 2, 2 days left: last chance → a miss
    assert not sun.counted  # out of reach: no guilt
    assert fri.week_done == 1


def test_habit_streak_forgives_one_miss(client):
    (a, b) = _make(client, {"name": "a"}, {"name": "b"})
    _backdate(30)
    t = _today()
    for k in (6, 5, 4, 2, 1):  # a misses only t-3
        _entry(a["id"], t - timedelta(days=k))
    for k in (6, 5, 4, 3):  # b misses t-2 and t-1
        _entry(b["id"], t - timedelta(days=k))
    with Session(engine) as s:
        book = Book(s, t - timedelta(days=30), t)
        ha, hb = s.get(Habit, a["id"]), s.get(Habit, b["id"])
        assert book.habit_streak(ha, t) == {"current": 5, "at_risk": False}
        assert book.habit_streak(hb, t)["current"] == 0
        assert book.best_habit_streak(ha) == 5
        assert book.best_habit_streak(hb) == 4


def test_at_risk_after_a_miss(client):
    (a,) = _make(client, {"name": "a"})
    _backdate(30)
    t = _today()
    for k in (4, 3, 2):
        _entry(a["id"], t - timedelta(days=k))
    with Session(engine) as s:
        book = Book(s, t - timedelta(days=30), t)
        assert book.habit_streak(s.get(Habit, a["id"]), t) == {"current": 3, "at_risk": True}


def test_rest_day_and_modes(client):
    hs = _make(client, {"name": "늘"}, {"name": "주말만"})
    modes = client.get("/api/modes").json()["modes"]
    weekend = next(m for m in modes if m["name"] == "주말")
    h = hs[1]
    client.put(f"/api/habits/{h['id']}", json={**{k: h[k] for k in ("name", "emoji", "kind", "slot")}, "modes": [weekend["id"]]})
    d = _today().isoformat()
    t = client.get("/api/today").json()
    assert [x["name"] for x in t["habits"]] == ["늘"]
    t = client.put("/api/day/mode", json={"day": d, "mode_id": weekend["id"]}).json()
    assert t["mode"]["name"] == "주말" and len(t["habits"]) == 2
    t = client.put("/api/day/mode", json={"day": d, "mode_id": None}).json()
    assert t["mode"]["is_default"]

    t = client.put("/api/day/rest", json={"day": d, "rest": True}).json()
    assert t["signal"]["color"] == "rest" and t["rest"]["kind"] == "break"
    t = client.put("/api/day/rest", json={"day": d, "rest": False}).json()
    assert t["rest"] is None

    # Default mode can't be deleted; others can, and leave habits pointing nowhere.
    default = next(m for m in modes if m["is_default"])
    assert client.delete(f"/api/modes/{default['id']}").status_code == 400
    client.delete(f"/api/modes/{weekend['id']}")
    with Session(engine) as s:
        assert s.get(Habit, h["id"]).modes == ""
        assert s.get(Mode, weekend["id"]) is None


def test_todos_journal_and_stats(client):
    _make(client, {"name": "a"})
    d = _today().isoformat()
    t = client.put("/api/todos/abc", json={"title": "논문 그림 수정", "day": d, "time": "14:00"}).json()
    assert t["todos"][0]["title"] == "논문 그림 수정"
    t = client.put("/api/todos/abc", json={"done": True}).json()
    assert t["todos"][0]["done"] is True
    t = client.put(f"/api/journal/{d}", json={"mood": 4, "answers": {"오늘 가장 잘한 일은?": "러닝 10km"}, "note": "좋은 날"}).json()
    assert t["log"]["mood"] == 4 and t["log"]["answers"]["오늘 가장 잘한 일은?"] == "러닝 10km"
    j = client.get("/api/journal").json()
    assert j["entries"][0]["note"] == "좋은 날"
    st = client.get("/api/stats").json()
    assert len(st["calendar"]) == 371 and st["habits"][0]["name"] == "a"
    assert any(b["key"] == "journal_7" for b in st["badges"])
    assert client.get("/api/export").json()["habit"][0]["name"] == "a"


def test_archive_keeps_history(client):
    (a,) = _make(client, {"name": "a"})
    _backdate(10)
    _entry(a["id"], _today() - timedelta(days=1))
    client.post(f"/api/habits/{a['id']}/archive", json={"archived": True})
    assert client.get("/api/today").json()["habits"] == []
    with Session(engine) as s:
        book = Book(s, _today() - timedelta(days=10), _today())
        assert book.day(_today() - timedelta(days=1)).done == 1


def test_remote_needs_pin(client):
    r = client.get("/api/today", headers=REMOTE)
    assert r.status_code == 403 and r.json()["code"] == "pin_not_set"
    assert client.put("/api/auth/pin", json={"pin": "2468"}, headers=REMOTE).status_code == 403
    assert client.put("/api/auth/pin", json={"pin": "2468"}).status_code == 200
    assert client.get("/api/today", headers=REMOTE).json()["code"] == "locked"
    assert client.post("/api/auth/unlock", json={"pin": "1111"}, headers=REMOTE).status_code == 401
    r = client.post("/api/auth/unlock", json={"pin": "2468"}, headers=REMOTE)
    assert r.status_code == 200
    assert client.get("/api/today", headers=REMOTE).status_code == 200


def test_scheduler_sends_each_reminder_once(client, monkeypatch):
    sent: list[dict] = []
    monkeypatch.setattr(scheduler.push, "send_all", lambda _s, msg: sent.append(msg) or 1)
    (h,) = _make(client, {"name": "러닝", "emoji": "🏃", "reminder": "18:30", "easy_name": "걷기"})
    client.put("/api/settings", json={"changes": {"morning_time": "07:30", "review_time": "22:00"}})
    base = datetime.combine(_today(), datetime.min.time())
    out = scheduler.tick(base.replace(hour=18, minute=31))
    assert [m["tag"] for m in out] == [f"habit-{h['id']}"]
    assert [a["action"] for a in out[0]["actions"]] == ["done", "easy"]
    assert scheduler.tick(base.replace(hour=18, minute=32)) == []
    assert [m["tag"] for m in scheduler.tick(base.replace(hour=7, minute=30))] == ["morning"]
    client.post("/api/entries/quick", json={"habit_id": h["id"], "action": "done"})
    assert [m["tag"] for m in scheduler.tick(base.replace(hour=22, minute=1))] == ["review"]
    assert len(sent) == 3
