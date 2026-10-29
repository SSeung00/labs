"""Attendance, streaks (with weekly freezes), the daily goal, achievements and the 오늘 plan.

Design notes (from Duolingo's published experiments and the research summary in docs/):
- The streak is kept by any real study (one review session, one reading, one conversation).
- Up to 2 freezes per week cover missed days automatically, so one bad day doesn't end a long streak.
- The daily goal (minutes) is separate from the streak, and rewards time on material, not XP.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlmodel import Session, func, select

from app.core import store
from app.learn import levels, lexicon, srs
from app.models import (
    INPUT_KINDS,
    Achievement,
    Activity,
    Conversation,
    DayRecord,
    Placement,
    Reading,
    ReviewLog,
)

FREEZE_KEY = "streak_freezes"
FREEZES_PER_WEEK = 2
MAX_GAP_FILL = 21


def _week(d: date) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def _freezes(session: Session) -> dict:
    return store.get(session, FREEZE_KEY, None) or {"count": FREEZES_PER_WEEK, "week": _week(date.today())}


def today_minutes(session: Session, day: date | None = None) -> float:
    day = day or date.today()
    return float(session.exec(select(func.coalesce(func.sum(Activity.minutes), 0.0)).where(Activity.day == day)).one())


def log_activity(session: Session, kind: str, minutes: float, ref_id: int | None = None, note: str | None = None,
                 commit: bool = True, book_id: int | None = None) -> None:
    today = date.today()
    minutes = max(0.0, min(float(minutes), 600.0))
    session.add(Activity(created_at=datetime.now(), day=today, kind=kind, minutes=round(minutes, 2),
                         ref_id=ref_id, note=note, book_id=book_id))
    session.flush()
    rec = session.get(DayRecord, today) or DayRecord(day=today)
    rec.frozen = False
    goal = float(store.profile(session)["daily_goal_minutes"])
    rec.goal_met = today_minutes(session, today) >= goal
    session.add(rec)
    if commit:
        session.commit()


def reconcile(session: Session) -> None:
    """Fill missed days with freezes (if any are left), refilling freezes at each new ISO week."""
    fz = _freezes(session)
    today = date.today()
    last = session.exec(select(DayRecord.day).where(DayRecord.day < today).order_by(DayRecord.day.desc())).first()
    changed = False
    if last is not None and (today - last).days - 1 <= MAX_GAP_FILL:
        d = last + timedelta(days=1)
        while d < today:
            if _week(d) != fz["week"]:
                fz = {"count": FREEZES_PER_WEEK, "week": _week(d)}
                changed = True
            if session.get(DayRecord, d) is None:
                if fz["count"] <= 0:
                    break
                session.add(DayRecord(day=d, frozen=True))
                fz["count"] -= 1
                changed = True
            d += timedelta(days=1)
    if _week(today) != fz["week"]:
        fz = {"count": FREEZES_PER_WEEK, "week": _week(today)}
        changed = True
    if changed:
        store.put(session, FREEZE_KEY, fz, commit=False)
        session.commit()


def streak(session: Session) -> dict:
    days = {r.day: r for r in session.exec(select(DayRecord)).all()}
    today = date.today()
    cur = 0
    d = today if today in days else today - timedelta(days=1)
    while d in days:
        cur += 1
        d -= timedelta(days=1)
    longest = run = 0
    prev: date | None = None
    for d in sorted(days):
        run = run + 1 if prev and (d - prev).days == 1 else 1
        longest = max(longest, run)
        prev = d
    goal_run = 0
    d = today if (today in days and days[today].goal_met) else today - timedelta(days=1)
    while d in days and days[d].goal_met:
        goal_run += 1
        d -= timedelta(days=1)
    return {
        "current": cur,
        "longest": longest,
        "studied_today": today in days and not days[today].frozen,
        "at_risk": cur > 0 and today not in days,
        "freezes": _freezes(session)["count"],
        "goal_streak": goal_run,
        "days_total": sum(1 for r in days.values() if not r.frozen),
    }


def calendar(session: Session, days: int = 84) -> list[dict]:
    start = date.today() - timedelta(days=days - 1)
    mins = dict(session.exec(
        select(Activity.day, func.sum(Activity.minutes)).where(Activity.day >= start).group_by(Activity.day)
    ).all())
    recs = {r.day: r for r in session.exec(select(DayRecord).where(DayRecord.day >= start)).all()}
    out = []
    for i in range(days):
        d = start + timedelta(days=i)
        r = recs.get(d)
        out.append({"day": d.isoformat(), "minutes": round(float(mins.get(d, 0) or 0), 1),
                    "frozen": bool(r and r.frozen), "goal_met": bool(r and r.goal_met)})
    return out


def minutes_by_kind(session: Session, since: date | None = None) -> dict[str, float]:
    q = select(Activity.kind, func.sum(Activity.minutes)).group_by(Activity.kind)
    if since:
        q = q.where(Activity.day >= since)
    return {k: round(float(m or 0), 1) for k, m in session.exec(q).all()}


def input_hours(session: Session) -> float:
    total = session.exec(select(func.coalesce(func.sum(Activity.minutes), 0.0)).where(
        Activity.kind.in_(INPUT_KINDS))).one()  # type: ignore[attr-defined]
    return round(float(total) / 60, 1)


# ---------- achievements ----------

BADGES: list[tuple[str, str, str]] = [
    ("placement", "첫 레벨 진단", "출발점을 확인했어요"),
    ("day1", "첫 출석", "시작이 반"),
    ("streak7", "7일 연속", "일주일 습관 완성"),
    ("streak30", "30일 연속", "한 달 동안 매일"),
    ("streak100", "100일 연속", "습관이 된 영어"),
    ("streak365", "365일 연속", "1년 내내"),
    ("goal7", "목표 7일 연속", "일일 목표를 일주일 내내 달성"),
    ("input10", "입력 10시간", "읽고 들은 시간 누적"),
    ("input50", "입력 50시간", ""),
    ("input100", "입력 100시간", ""),
    ("input250", "입력 250시간", ""),
    ("input500", "입력 500시간", ""),
    ("input1000", "입력 1,000시간", "C1~C2로 가는 입력량"),
    ("words3000", "어휘 3,000", "일상 대화의 95%"),
    ("words5000", "어휘 5,000", ""),
    ("words7000", "어휘 7,000", ""),
    ("words9500", "어휘 9,500", "무자막 드라마의 98% 수준"),
    ("reviews100", "복습 100회", ""),
    ("reviews1000", "복습 1,000회", ""),
    ("reviews5000", "복습 5,000회", ""),
    ("talk1", "첫 AI 대화", ""),
    ("talk10", "AI 대화 10회", ""),
    ("talk50", "AI 대화 50회", ""),
    ("talk10h", "말하기 10시간", ""),
    ("read10", "읽기 10편", ""),
    ("read50", "읽기 50편", ""),
    ("levelB2", "B2 도달", "종합 레벨 B2"),
    ("levelC1", "C1 도달", "종합 레벨 C1"),
    ("levelC2", "C2 도달", "종합 레벨 C2"),
]
BADGE_INFO = {k: (t, d) for k, t, d in BADGES}


def _earned(session: Session) -> set[str]:
    st = streak(session)
    hours = input_hours(session)
    words = lexicon.known_count(session) if session.exec(select(func.count()).select_from(Placement).where(
        Placement.finished_at.is_not(None))).one() else 0  # type: ignore[union-attr]
    reviews = session.exec(select(func.count()).select_from(ReviewLog)).one()
    talks = session.exec(select(func.count()).select_from(Conversation).where(
        Conversation.ended_at.is_not(None))).one()  # type: ignore[union-attr]
    talk_min = float(session.exec(select(func.coalesce(func.sum(Activity.minutes), 0.0)).where(Activity.kind == "talk")).one())
    reads = session.exec(select(func.count()).select_from(Reading).where(Reading.finished_at.is_not(None))).one()  # type: ignore[union-attr]
    overall = levels.current(session)["overall"] or 0
    placed = session.exec(select(func.count()).select_from(Placement).where(Placement.finished_at.is_not(None))).one()  # type: ignore[union-attr]
    got = set()
    checks = {
        "placement": placed > 0, "day1": st["days_total"] >= 1, "streak7": st["longest"] >= 7,
        "streak30": st["longest"] >= 30, "streak100": st["longest"] >= 100, "streak365": st["longest"] >= 365,
        "goal7": st["goal_streak"] >= 7,
        "input10": hours >= 10, "input50": hours >= 50, "input100": hours >= 100, "input250": hours >= 250,
        "input500": hours >= 500, "input1000": hours >= 1000,
        "words3000": words >= 3000, "words5000": words >= 5000, "words7000": words >= 7000, "words9500": words >= 9500,
        "reviews100": reviews >= 100, "reviews1000": reviews >= 1000, "reviews5000": reviews >= 5000,
        "talk1": talks >= 1, "talk10": talks >= 10, "talk50": talks >= 50, "talk10h": talk_min >= 600,
        "read10": reads >= 10, "read50": reads >= 50,
        "levelB2": overall >= 4.0, "levelC1": overall >= 5.0, "levelC2": overall >= 6.0,
    }
    for k, ok in checks.items():
        if ok:
            got.add(k)
    return got


def update_achievements(session: Session) -> list[dict]:
    """Record newly earned badges; return all badges with state."""
    have = {a.key: a for a in session.exec(select(Achievement)).all()}
    for key in _earned(session) - set(have):
        a = Achievement(key=key, achieved_at=datetime.now(), seen=False)
        session.add(a)
        have[key] = a
    session.commit()
    return [
        {"key": k, "title": t, "desc": d, "achieved_at": have[k].achieved_at.isoformat(timespec="minutes") if k in have else None,
         "new": k in have and not have[k].seen}
        for k, t, d in BADGES
    ]


def mark_seen(session: Session) -> None:
    for a in session.exec(select(Achievement).where(Achievement.seen == False)).all():  # noqa: E712
        a.seen = True
        session.add(a)
    session.commit()


# ---------- the 오늘 plan ----------

# Share of planned study time per block when there is no study plan yet. Input (reading + listening)
# gets the most: at B2→C2 the volume of comprehensible input matters most, with speaking output and SRS
# review alongside. With a plan, the targets come from its current phase instead (see learn/plan.py).
SPLIT = {"read": 0.25, "listen": 0.30, "talk": 0.25, "review": 0.20}
BLOCK_KINDS = {"read": ("read",), "listen": ("listen", "external"), "talk": ("talk",), "review": ("review", "drill"),
               "write": ("write",)}
BLOCK_INFO = {
    "review": ("복습", "FSRS 단어·교정 카드", "/words/review"),
    "read": ("읽기", "내 수준에 맞춘 글 읽기", "/read"),
    "listen": ("듣기", "읽기 자료 듣기 · 넷플릭스·팟캐스트 기록", "/read?mode=listen"),
    "talk": ("말하기", "AI와 음성 대화", "/talk"),
    "write": ("쓰기", "TOEFL 이메일·토론 · 손글씨 첨삭", "/write"),
}


def _done_today(session: Session) -> tuple[dict[str, float], dict[int, float]]:
    """Today's minutes per activity kind (book study excluded) and per book."""
    rows = session.exec(select(Activity).where(Activity.day == date.today())).all()
    kinds: dict[str, float] = {}
    per_book: dict[int, float] = {}
    for r in rows:
        if r.book_id:
            per_book[r.book_id] = per_book.get(r.book_id, 0.0) + r.minutes
        else:
            kinds[r.kind] = kinds.get(r.kind, 0.0) + r.minutes
    return kinds, per_book


def today(session: Session) -> dict:
    from app.learn import books, plan  # (they import this module)

    reconcile(session)
    p = store.profile(session)
    total = int(p["daily_minutes"])
    done, done_books = _done_today(session)
    q = srs.counts(session)
    review_need = min(45, round((q["due"] + min(q["new"], int(p["new_cards_per_day"]))) * 12 / 60))
    active_plan = plan.active(session)
    if active_plan:
        plan.activate_due_books(session, active_plan)
    planned = plan.today_targets(session, active_plan) if active_plan else None
    act_books = books.active_books(session)
    book_targets = {b.id: plan.book_today(session, b) for b in act_books}
    if planned is None:
        planned = {k: round(total * share) for k, share in SPLIT.items()}
        # Without a plan, a book's time comes out of the block it trains.
        for b in act_books:
            blk = plan.BOOK_BLOCK.get(b.skill, "read")
            planned[blk] = max(0, planned.get(blk, 0) - book_targets[b.id])
    blocks = []
    for key, (title, desc, link) in BLOCK_INFO.items():
        target = int(planned.get(key, 0))
        if key == "review":
            target = max(5, min(max(target, 5), review_need)) if (q["due"] or q["new"]) else 0
        minutes = sum(done.get(k, 0.0) for k in BLOCK_KINDS[key])
        if target <= 0 and minutes <= 0:
            continue
        blocks.append({"key": key, "title": title, "desc": desc, "link": link, "target": target,
                       "done": round(minutes, 1), "complete": target > 0 and minutes >= target})
    for b in act_books:
        nxt = books.next_unit(b)
        unit = f"{b.unit_label} {nxt + 1} · {b.units[nxt]['title']}" if nxt is not None else "복습"
        minutes = done_books.get(b.id, 0.0)
        target = book_targets[b.id]
        blocks.append({"key": "book", "book_id": b.id, "title": b.title, "desc": unit, "link": f"/plan/books/{b.id}",
                       "target": target, "done": round(minutes, 1), "complete": target > 0 and minutes >= target})
    placed = session.exec(select(func.count()).select_from(Placement).where(Placement.finished_at.is_not(None))).one()  # type: ignore[union-attr]
    goal = float(p["daily_goal_minutes"])
    mins = today_minutes(session)
    tip = store.get(session, "coach_tip") or {}
    return {
        "date": date.today().isoformat(),
        "needs_placement": placed == 0,
        "goal_minutes": goal,
        "minutes": round(mins, 1),
        "goal_met": mins >= goal,
        "blocks": blocks,
        "has_plan": active_plan is not None,
        "streak": streak(session),
        "cards": q,
        "coach_tip": tip.get("text") if tip.get("day") == date.today().isoformat() else None,
    }
