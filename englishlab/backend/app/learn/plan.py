"""The study plan and how well the learner keeps to it.

A plan runs from today to the target date in 3–5 phases. Each phase sets weekly minutes per block
(review, read, listen, talk, write, book), and milestones set skill levels to reach by given dates. The AI
writes it from the skill estimate, the forecast, recent study time, recurring mistakes and the books the
learner added; the numbers are then normalised so they add up to the learner's daily study time.

Tracking compares this week's minutes per block with the phase targets (and with what should be done by
today), looks back over past weeks, checks each milestone against the forecast, and shows each book's
progress against its schedule. 오늘's course is derived from the same targets, so a short day raises the
next days' targets a little.
"""

from __future__ import annotations

import logging
import threading
from datetime import date, datetime, timedelta

from sqlmodel import Session, select

from app.core import llm, store
from app.core.llm import INT, NUM, STR, arr, obj
from app.db import engine
from app.learn import books, forecast, levels, lexicon, mistakes, progress
from app.learn.levels import CORE
from app.models import BLOCKS, Activity, Book, StudyPlan

log = logging.getLogger("englishlab.plan")

DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
BLOCK_LABEL = {"review": "복습", "read": "읽기", "listen": "듣기", "talk": "말하기", "write": "쓰기", "book": "교재"}
# Activity kind → plan block (book study goes to the book block whatever its kind).
KIND_BLOCK = {"review": "review", "drill": "review", "read": "read", "listen": "listen", "external": "listen",
              "talk": "talk", "write": "write"}
# Book skill → the block its minutes come out of when a book is added after the plan was made.
BOOK_BLOCK = {"reading": "read", "listening": "listen", "speaking": "talk", "writing": "write", "vocab": "review",
              "grammar": "review", "mixed": "read"}


def enum(values: list[str]) -> dict:
    return {"type": "string", "enum": values}


PLAN_SCHEMA = obj({
    "summary_ko": STR,
    "realistic_goal_ko": STR,
    "goal": obj({s: NUM for s in CORE}),
    "phases": arr(obj({
        "name_ko": STR, "start": STR, "end": STR, "focus_ko": STR,
        "weekly_minutes": obj({b: INT for b in BLOCKS}),
        "targets_ko": arr(STR),
    })),
    "milestones": arr(obj({"date": STR, "title_ko": STR, "skill_targets": obj({s: NUM for s in CORE}),
                           "check_ko": STR})),
    "routine": arr(obj({"day": enum(DAYS), "items": arr(obj({"block": enum(list(BLOCKS)), "minutes": INT,
                                                             "what_ko": STR}))})),
    "book_schedule": arr(obj({"book_id": INT, "start": STR, "days_per_week": INT, "minutes_per_session": INT,
                              "note_ko": STR})),
    "tips_ko": arr(STR),
})

BLOCK_GUIDE = (
    "Blocks the app measures (minutes): review = FSRS flashcards and correction cards; read = level-adapted "
    "reading in the app; listen = listening-first reading audio plus Netflix/YouTube/podcasts the learner logs; "
    "talk = voice conversation with the AI tutor (role-plays, TOEFL-style interviews); write = writing tasks "
    "with AI correction (TOEFL email / academic discussion, journal); book = study from the books listed below."
)


def active(session: Session) -> StudyPlan | None:
    return session.exec(select(StudyPlan).where(StudyPlan.active == True)).first()  # noqa: E712


def generating(session: Session) -> StudyPlan | None:
    return session.exec(select(StudyPlan).where(StudyPlan.status == "generating")
                        .order_by(StudyPlan.id.desc())).first()


def _facts(session: Session, note: str | None) -> dict:
    p = store.profile(session)
    cur = levels.current(session)
    fc = forecast.forecast(session, plan=None)
    since = date.today() - timedelta(days=27)
    mins = progress.minutes_by_kind(session, since=since)
    bks = session.exec(select(Book).where(Book.status.in_(["ready", "active", "paused"]))).all()  # type: ignore[attr-defined]
    return {
        "today": date.today().isoformat(),
        "target_date": fc["target_date"],
        "goal_text": p["goal"],
        "learner_request": note or "",
        "daily_study_minutes": p["daily_minutes"],
        "weekly_total_minutes": int(p["daily_minutes"]) * 7,
        "skills_now": {s: ({"level": d["level"], "uncertainty_sd": d["sd"], "evidence": d["evidence"]} if d else None)
                       for s, d in cur["detail"].items()},
        "vocab_lemmas": lexicon.known_count(session),
        "personal_learning_rate": cur["rate"]["rate"],
        "forecast_at_current_pace": {s: (v["pace"] if v else None) for s, v in fc["skills"].items()},
        "effective_hours_needed_per_day_for_goal": {s: (v["needed_hours_per_day"] if v else None)
                                                    for s, v in fc["skills"].items()},
        "minutes_last_4_weeks": mins,
        "top_mistakes": [m.pattern for m in mistakes.top(session, 6)],
        "interests": p["interests"],
        "books": [{"book_id": b.id, "title": b.title, "skill": b.skill, "status": b.status,
                   "units": len(b.units), "units_done": len(b.units_done or []),
                   "level_range": [(b.info or {}).get("level_min"), (b.info or {}).get("level_max")],
                   "fit": (b.info or {}).get("fit"), "recommended": (b.info or {}).get("recommended"),
                   "exam": (b.info or {}).get("exam")} for b in bks],
    }


def _prompt(session: Session, note: str | None) -> str:
    return llm.as_json_block(
        "You are an expert English-learning coach (SLA research, CEFR, TOEFL iBT 2026 format). Write this "
        "learner's study plan from today to the target date.\n"
        f"{BLOCK_GUIDE}\n"
        "Rules:\n"
        "- phases: 3-5 contiguous phases covering today → target date (ISO dates). Each phase's weekly_minutes "
        "over the six blocks should add up to about weekly_total_minutes. Put most time into comprehensible "
        "input (read + listen) early, grow output (talk + write) and test-format practice toward the end. The "
        "book block = the weekly minutes of the books scheduled in that phase (0 if none).\n"
        "- goal: realistic but ambitious target levels (1-6 scale, B2=4, C1=5, C2=6) at the target date, "
        "consistent with the forecast and needed hours; explain honestly in realistic_goal_ko if the learner's "
        "stated goal is out of reach and what is reachable.\n"
        "- milestones: every 4-6 weeks, with skill targets and how to check them (re-take the app's placement "
        "test, a mock test from a book, a TOEFL-style interview with the AI tutor).\n"
        "- routine: a typical week (mon-sun) whose items add up to the daily study minutes; what_ko says "
        "concretely what to do (e.g. 'Hackers Reading Ch.3 + 모르는 단어 카드 저장').\n"
        "- book_schedule: one entry for every book listed (start date, days per week, minutes per session) — "
        "a book that is too hard now starts later.\n"
        "- summary_ko: 3-4 sentences on the strategy; tips_ko: 3-5 short, specific tips.\n"
        "Korean for *_ko fields. Learner data:", _facts(session, note))


def _d(value: str | None, default: date) -> date:
    try:
        return date.fromisoformat((value or "")[:10])
    except ValueError:
        return default


def _normalise(data: dict, today: date, target: date, daily: int) -> dict:
    phases = []
    for ph in data.get("phases") or []:
        wm = {b: max(0, int((ph.get("weekly_minutes") or {}).get(b) or 0)) for b in BLOCKS}
        phases.append({"name_ko": ph.get("name_ko") or "단계", "start": _d(ph.get("start"), today),
                       "end": _d(ph.get("end"), target), "focus_ko": ph.get("focus_ko") or "",
                       "weekly_minutes": wm, "targets_ko": ph.get("targets_ko") or []})
    phases.sort(key=lambda x: x["start"])
    if not phases:
        third = {b: 0 for b in BLOCKS} | {"read": daily * 7 // 4, "listen": daily * 7 * 3 // 10,
                                          "talk": daily * 7 // 4, "review": daily * 7 // 5}
        phases = [{"name_ko": "기본 단계", "start": today, "end": target, "focus_ko": "", "weekly_minutes": third,
                   "targets_ko": []}]
    # Contiguous from today to the target date.
    phases[0]["start"] = today
    for prev, cur in zip(phases, phases[1:], strict=False):
        cur["start"] = max(cur["start"], prev["start"] + timedelta(days=1))
        prev["end"] = cur["start"] - timedelta(days=1)
    phases[-1]["end"] = max(phases[-1]["start"], target)
    week_total = daily * 7
    for ph in phases:
        total = sum(ph["weekly_minutes"].values())
        if total and abs(total - week_total) > 0.15 * week_total:
            k = week_total / total
            ph["weekly_minutes"] = {b: int(round(m * k)) for b, m in ph["weekly_minutes"].items()}
        ph["start"], ph["end"] = ph["start"].isoformat(), ph["end"].isoformat()
    milestones = []
    for m in data.get("milestones") or []:
        d = _d(m.get("date"), target)
        if today <= d <= target + timedelta(days=31):
            milestones.append({"date": d.isoformat(), "title_ko": m.get("title_ko") or "",
                               "skill_targets": {s: max(1.0, min(6.0, float((m.get("skill_targets") or {}).get(s) or 0) or 1.0))
                                                 for s in CORE},
                               "check_ko": m.get("check_ko") or ""})
    milestones.sort(key=lambda m: m["date"])
    goal = {s: max(1.0, min(6.0, float((data.get("goal") or {}).get(s) or forecast.DEFAULT_GOAL))) for s in CORE}
    routine = [{"day": r["day"], "items": [i for i in r.get("items") or [] if i.get("block") in BLOCKS]}
               for r in data.get("routine") or [] if r.get("day") in DAYS]
    routine.sort(key=lambda r: DAYS.index(r["day"]))
    return {"phases": phases, "milestones": milestones, "goal": goal, "routine": routine}


def generate(session: Session, plan: StudyPlan) -> StudyPlan:
    p = store.profile(session)
    today = date.today()
    fc = forecast.forecast(session, plan=None)
    target = date.fromisoformat(fc["target_date"])
    data = llm.call_json(session, "plan", PLAN_SCHEMA, max_tokens=16000,
                         messages=[{"role": "user", "content": _prompt(session, plan.note)}])
    norm = _normalise(data, today, target, int(p["daily_minutes"]))
    plan.start, plan.end = today, target
    plan.goal, plan.phases, plan.milestones, plan.routine = norm["goal"], norm["phases"], norm["milestones"], norm["routine"]
    plan.data = {"summary_ko": data.get("summary_ko"), "realistic_goal_ko": data.get("realistic_goal_ko"),
                 "tips_ko": data.get("tips_ko") or [], "book_schedule": data.get("book_schedule") or [],
                 "forecast_at_creation": fc["overall"]}
    # Apply the book schedule: listed books get the suggested start and intensity.
    for bs in data.get("book_schedule") or []:
        book = session.get(Book, int(bs.get("book_id") or 0))
        if not book or book.status not in ("ready", "active", "paused"):
            continue
        start = _d(bs.get("start"), today)
        if start <= today or book.status == "active":
            books.activate(session, book, start=min(start, today) if book.status != "active" else book.start_date,
                           days_per_week=bs.get("days_per_week"), minutes_per_session=bs.get("minutes_per_session"))
        else:  # starts later: keep it ready with its intensity, the plan shows when
            book.start_date = start
            book.days_per_week = max(1, min(7, int(bs.get("days_per_week") or book.days_per_week)))
            book.minutes_per_session = max(10, min(240, int(bs.get("minutes_per_session") or book.minutes_per_session)))
            session.add(book)
    for old in session.exec(select(StudyPlan).where(StudyPlan.active == True)).all():  # noqa: E712
        old.active = False
        session.add(old)
    plan.status, plan.error, plan.active = "ready", None, True
    session.add(plan)
    session.commit()
    session.refresh(plan)
    return plan


def start_generation(session: Session, note: str | None) -> StudyPlan:
    running = generating(session)
    if running:
        return running
    today = date.today()
    plan = StudyPlan(created_at=datetime.now(), start=today, end=today, note=(note or "").strip()[:500] or None)
    session.add(plan)
    session.commit()
    session.refresh(plan)
    pid = plan.id

    def run():
        with Session(engine) as s:
            row = s.get(StudyPlan, pid)
            if not row:
                return
            try:
                generate(s, row)
            except Exception as e:  # shown on the plan page with a retry button
                log.warning("plan generation failed: %s", e)
                s.rollback()
                row = s.get(StudyPlan, pid)
                if row:
                    row.status, row.error = "error", str(e)[:400]
                    s.add(row)
                    s.commit()

    threading.Thread(target=run, daemon=True, name=f"plan-{pid}").start()
    return plan


# ---------- tracking ----------

def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def phase_at(plan: StudyPlan, d: date) -> tuple[int, dict] | None:
    for i, ph in enumerate(plan.phases or []):
        if ph["start"] <= d.isoformat() <= ph["end"]:
            return i, ph
    if plan.phases and d.isoformat() > plan.phases[-1]["end"]:
        return len(plan.phases) - 1, plan.phases[-1]
    return None


def effective_weekly(session: Session, weekly: dict[str, float]) -> dict[str, float]:
    """Phase minutes adjusted for the books actually scheduled now: the book block becomes the sum of the
    active books' weekly minutes, and any extra comes out of the blocks those books train."""
    out = {b: float(weekly.get(b, 0) or 0) for b in BLOCKS}
    act = books.active_books(session)
    book_week = sum(books.weekly_minutes(b) for b in act)
    extra = book_week - out["book"]
    out["book"] = book_week
    if extra > 0:
        for b in act:
            share = extra * books.weekly_minutes(b) / book_week
            blk = BOOK_BLOCK.get(b.skill, "read")
            take = min(out[blk], share)
            out[blk] -= take
            share -= take
            for other in ("read", "listen", "review", "talk", "write"):  # the rest proportionally
                if share <= 0:
                    break
                t = min(out[other], share)
                out[other] -= t
                share -= t
    elif extra < 0:  # fewer books than planned: give the time back to reading and listening
        out["read"] += -extra / 2
        out["listen"] += -extra / 2
    return {b: round(v) for b, v in out.items()}


def block_minutes(session: Session, a: date, b: date) -> dict[str, float]:
    rows = session.exec(select(Activity).where(Activity.day >= a, Activity.day <= b)).all()
    out = dict.fromkeys(BLOCKS, 0.0)
    for r in rows:
        blk = "book" if r.book_id else KIND_BLOCK.get(r.kind)
        if blk:
            out[blk] += r.minutes
    return out


def book_minutes(session: Session, a: date, b: date) -> dict[int, float]:
    rows = session.exec(select(Activity).where(Activity.day >= a, Activity.day <= b,
                                               Activity.book_id.is_not(None))).all()  # type: ignore[union-attr]
    out: dict[int, float] = {}
    for r in rows:
        out[r.book_id] = out.get(r.book_id, 0.0) + r.minutes
    return out


def _state(ratio: float | None) -> str:
    if ratio is None:
        return "none"
    return "ahead" if ratio >= 1.1 else "on_track" if ratio >= 0.85 else "slightly_behind" if ratio >= 0.6 else "behind"


def _week_window(plan: StudyPlan, today: date) -> tuple[date, int, int]:
    """(first day counted this week, days elapsed including today, days of this week the plan covers).
    The plan's first week only counts from the day it was made."""
    ws = week_start(today)
    start = max(ws, plan.start)
    return start, (today - start).days + 1, (ws + timedelta(days=6) - start).days + 1


def activate_due_books(session: Session, plan: StudyPlan) -> None:
    """Books the plan scheduled to start later become active on their start date."""
    today = date.today()
    ids = {int(bs.get("book_id") or 0) for bs in (plan.data or {}).get("book_schedule") or []}
    for book in session.exec(select(Book).where(Book.status == "ready")).all():
        if book.id in ids and book.start_date and book.start_date <= today:
            books.activate(session, book, start=book.start_date)


def track(session: Session, plan: StudyPlan) -> dict:
    activate_due_books(session, plan)
    today = date.today()
    ws = week_start(today)
    start, elapsed, span = _week_window(plan, today)
    at = phase_at(plan, today)
    weekly = effective_weekly(session, at[1]["weekly_minutes"]) if at else dict.fromkeys(BLOCKS, 0)
    done = block_minutes(session, start, today)
    blocks = []
    for b in BLOCKS:
        target = weekly.get(b, 0) * span / 7
        if not target and not done[b]:
            continue
        expected = weekly.get(b, 0) * (elapsed - 1) / 7  # what should be done by the end of yesterday
        blocks.append({"key": b, "title": BLOCK_LABEL[b], "target": round(target), "done": round(done[b], 1),
                       "expected": round(expected, 1),
                       "state": _state(done[b] / expected if expected else None)})
    total_target = sum(weekly.values()) * span / 7
    total_done = sum(done.values())
    # Judged against the days already over, so the day's own study is not yet "missing" in the morning.
    expected_total = sum(weekly.values()) * (elapsed - 1) / 7
    week_ratio = total_done / expected_total if expected_total else None

    # Past full weeks since the plan started (up to 8).
    weeks = []
    w = week_start(plan.start)
    while w < ws and len(weeks) < 52:
        a = phase_at(plan, w + timedelta(days=3))
        tw = sum(effective_weekly(session, a[1]["weekly_minutes"]).values()) if a else 0
        dw = sum(block_minutes(session, max(w, plan.start), w + timedelta(days=6)).values())
        days = (w + timedelta(days=6) - max(w, plan.start)).days + 1
        tw = tw * days / 7
        weeks.append({"start": w.isoformat(), "target": round(tw), "done": round(dw),
                      "ratio": round(dw / tw, 2) if tw else None})
        w += timedelta(days=7)
    weeks = weeks[-8:]
    past = [x["ratio"] for x in weeks if x["ratio"] is not None]
    past_ratio = sum(past) / len(past) if past else None

    fc = forecast.forecast(session, plan=plan)

    def at_date(scenario: str, d: str) -> dict:
        rows = fc["series"].get(scenario, [])
        row = next((r for r in rows if r["d"] >= d), rows[-1] if rows else {})
        return {s: row.get(s) for s in CORE if row.get(s) is not None}

    def reaches(pred: dict, targets: dict) -> bool:
        return bool(pred) and min(pred[s] - targets[s] for s in pred) >= -0.15

    milestones = []
    for m in plan.milestones or []:
        pred = at_date("pace", m["date"])
        by_plan = at_date("plan", m["date"])
        gaps = {s: round(pred[s] - m["skill_targets"][s], 2) for s in pred}
        on_track = reaches(pred, m["skill_targets"])
        # on_track: the current pace gets there; with_plan: keeping to the plan would; at_risk: neither.
        status = "on_track" if on_track else "with_plan" if reaches(by_plan, m["skill_targets"]) else "at_risk"
        milestones.append({**m, "forecast": pred, "plan_forecast": by_plan, "gaps": gaps,
                           "past": m["date"] < today.isoformat(), "on_track": on_track, "status": status})

    bks = [books.view(session, b) for b in session.exec(select(Book).where(Book.status.in_(["active", "ready", "paused", "done"]))  # type: ignore[attr-defined]
                                                        .order_by(Book.id)).all()]
    ratio = week_ratio if past_ratio is None else (0.6 * past_ratio + 0.4 * week_ratio if week_ratio is not None else past_ratio)
    state = _state(ratio)
    behind_books = [b["title"] for b in bks if b["status"] == "active" and b["progress"]["state"] == "behind"]
    goal_gap = None
    if fc["overall"]["pace"] is not None:
        goal_gap = round(fc["overall"]["pace"] - fc["overall"]["goal"], 2)
    text = {"ahead": "계획보다 앞서가고 있어요.", "on_track": "계획대로 잘 가고 있어요.",
            "slightly_behind": "계획보다 조금 뒤처졌어요.", "behind": "계획보다 많이 뒤처졌어요.",
            "none": "계획을 막 시작했어요. 오늘의 코스부터 해 봐요." if not weeks else "이번 주가 막 시작됐어요."}[state]
    if behind_books:
        text += f" 교재 진도가 늦어요: {', '.join(behind_books)}."
    return {
        "phase": {"index": at[0], **at[1], "effective_weekly": weekly} if at else None,
        "week": {"start": start.isoformat(), "elapsed_days": elapsed, "blocks": blocks, "target": round(total_target),
                 "done": round(total_done), "expected": round(expected_total), "ratio": round(week_ratio, 2) if week_ratio is not None else None},
        "weeks": weeks,
        "milestones": milestones,
        "books": bks,
        "verdict": {"state": state, "ratio": round(ratio, 2) if ratio is not None else None, "text_ko": text,
                    "goal_gap": goal_gap},
        "forecast": fc,
    }


def view(plan: StudyPlan) -> dict:
    return {"id": plan.id, "created_at": plan.created_at.isoformat(timespec="minutes"), "status": plan.status,
            "error": plan.error, "note": plan.note, "start": plan.start.isoformat(), "end": plan.end.isoformat(),
            "goal": plan.goal, "phases": plan.phases, "milestones": plan.milestones, "routine": plan.routine,
            "summary_ko": (plan.data or {}).get("summary_ko"),
            "realistic_goal_ko": (plan.data or {}).get("realistic_goal_ko"),
            "tips_ko": (plan.data or {}).get("tips_ko") or [],
            "book_schedule": (plan.data or {}).get("book_schedule") or []}


# ---------- 오늘's course from the plan ----------

def today_targets(session: Session, plan: StudyPlan) -> dict[str, int] | None:
    """Minutes per block for today: what is left of this week's target spread over the days left (capped so
    one missed day doesn't make the next one huge)."""
    today = date.today()
    at = phase_at(plan, today)
    if not at:
        return None
    weekly = effective_weekly(session, at[1]["weekly_minutes"])
    start, _, span = _week_window(plan, today)
    before = block_minutes(session, start, today - timedelta(days=1)) if today > start else dict.fromkeys(BLOCKS, 0.0)
    days_left = 7 - today.weekday()
    out = {}
    for b in BLOCKS:
        if b == "book":
            continue
        remaining = max(0.0, weekly[b] * span / 7 - before[b])
        out[b] = int(round(min(remaining / days_left, weekly[b] / 7 * 1.6)))
    return out


def book_today(session: Session, book: Book) -> int:
    """Today's minutes for a book: one session, smaller if the week's book time is nearly done."""
    today = date.today()
    ws = week_start(today)
    start = max(ws, book.start_date or ws)
    span = (ws + timedelta(days=6) - start).days + 1
    before = book_minutes(session, start, today - timedelta(days=1)).get(book.id, 0.0) if today > start else 0.0
    remaining = max(0.0, books.weekly_minutes(book) * span / 7 - before)
    days_left = 7 - today.weekday()
    per_day = remaining / days_left * 7 / max(book.days_per_week, 1)
    return int(round(min(book.minutes_per_session, per_day)))


# ---------- weekly check-in ----------

CHECKIN_SCHEMA = obj({"text_ko": STR, "adjustments_ko": arr(STR)})


def checkin(session: Session, plan: StudyPlan, force: bool = False) -> dict:
    y, w, _ = date.today().isocalendar()
    key = f"{y}-W{w:02d}"
    if not force and key in (plan.checkins or {}):
        return plan.checkins[key]
    t = track(session, plan)
    facts = {
        "verdict": t["verdict"], "this_week": t["week"], "past_weeks": t["weeks"],
        "phase": {k: t["phase"][k] for k in ("name_ko", "focus_ko", "targets_ko", "effective_weekly")} if t["phase"] else None,
        "milestones": [{k: m[k] for k in ("date", "title_ko", "skill_targets", "forecast", "on_track")}
                       for m in t["milestones"] if not m["past"]][:3],
        "books": [{k: b[k] for k in ("title", "status", "progress")} for b in t["books"]],
        "forecast_overall": t["forecast"]["overall"],
        "skills_now": {s: (d["level"] if d else None) for s, d in levels.current(session)["detail"].items()},
        "top_mistakes": [m.pattern for m in mistakes.top(session, 4)],
    }
    out = llm.call_json(session, "checkin", CHECKIN_SCHEMA, max_tokens=4000, messages=[{"role": "user", "content": llm.as_json_block(
        "You are the learner's English coach. Review how this week is going against the plan. text_ko: 3-4 "
        "Korean sentences — specific numbers, what went well, what is slipping and why it matters for the next "
        "milestone. adjustments_ko: 2-4 concrete changes for the coming days (which block to add minutes to, "
        "which book unit to catch up, what to do in the AI conversation). No generic cheerleading.", facts)}])
    out["week"] = key
    out["at"] = datetime.now().isoformat(timespec="minutes")
    plan.checkins = {**(plan.checkins or {}), key: out}
    session.add(plan)
    session.commit()
    return out
