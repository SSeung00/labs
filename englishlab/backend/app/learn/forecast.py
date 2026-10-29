"""Where study leads: the projected level per skill up to the target date, and when C1/C2 would be reached.

Two scenarios: the learner's actual pace over the last two weeks, and the active plan's weekly minutes.
Both use the same growth model as the estimate in levels.py (effective hours × personal rate ÷ hours per
level step), and the uncertainty widens the further ahead the projection goes.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from datetime import date, timedelta

from sqlmodel import Session, select

from app.core import store
from app.learn import levels
from app.learn.levels import CORE, TRANSFER, hours_per_level
from app.models import Activity, Book, StudyPlan

DEFAULT_GOAL = 6.0  # "early C2" = band 6 on the TOEFL scale
HORIZON_DAYS = 900

# Book skill → the activity kind its study minutes are logged as.
BOOK_KIND = {"reading": "read", "listening": "listen", "speaking": "talk", "writing": "write", "vocab": "review",
             "grammar": "drill", "mixed": "drill"}
# Plan block → activity kind (the book block is split by the skills of the active books).
BLOCK_KIND = {"review": "review", "read": "read", "listen": "listen", "talk": "talk", "write": "write"}


def _hours_from_minutes(minutes_by_kind: dict[str, float]) -> dict[str, float]:
    out = dict.fromkeys(CORE, 0.0)
    for kind, m in minutes_by_kind.items():
        for skill, w in TRANSFER.get(kind, {}).items():
            out[skill] += m * w / 60
    return out


def recent_pace(session: Session, days: int = 14) -> tuple[dict[str, float], dict]:
    """Effective hours/day per skill over the last `days` days (or since the first activity)."""
    today = date.today()
    first = session.exec(select(Activity.day).order_by(Activity.day)).first()
    span = min(days, (today - first).days + 1) if first else 0
    if span < 3:
        # Too little history: assume the planned daily minutes with the default split.
        from app.learn.progress import SPLIT

        total = float(store.profile(session)["daily_minutes"])
        mins = {"read": total * SPLIT["read"], "listen": total * SPLIT["listen"], "talk": total * SPLIT["talk"],
                "review": total * SPLIT["review"]}
        return _hours_from_minutes(mins), {"days": span, "assumed": True}
    hours = levels.daily_hours(session, since=today - timedelta(days=span - 1))
    out = {s: sum(v[s] for v in hours.values()) / span for s in CORE}
    return out, {"days": span, "assumed": False}


def _book_kinds(session: Session) -> dict[str, float]:
    """Share of book time per activity kind, from the active books (reading if none)."""
    books = session.exec(select(Book).where(Book.status == "active")).all()
    if not books:
        return {"read": 1.0}
    out: dict[str, float] = {}
    for b in books:
        k = BOOK_KIND.get(b.skill, "drill")
        out[k] = out.get(k, 0.0) + 1 / len(books)
    return out


def weekly_to_hours(session: Session, weekly: dict[str, float]) -> dict[str, float]:
    """Plan weekly minutes per block → effective hours/day per skill."""
    mins: dict[str, float] = {}
    for block, m in (weekly or {}).items():
        if block == "book":
            for kind, share in _book_kinds(session).items():
                mins[kind] = mins.get(kind, 0.0) + float(m) * share / 7
        elif block in BLOCK_KIND:
            mins[BLOCK_KIND[block]] = mins.get(BLOCK_KIND[block], 0.0) + float(m) / 7
    return _hours_from_minutes(mins)


def plan_pace_fn(session: Session, plan: StudyPlan) -> Callable[[date], dict[str, float]]:
    phases = [(date.fromisoformat(p["start"]), date.fromisoformat(p["end"]), weekly_to_hours(session, p["weekly_minutes"]))
              for p in plan.phases or [] if p.get("start") and p.get("end")]
    last = phases[-1][2] if phases else dict.fromkeys(CORE, 0.0)

    def at(d: date) -> dict[str, float]:
        for a, b, h in phases:
            if a <= d <= b:
                return h
        return last

    return at


def _project(level: float, sd: float, rate: float, pace: Callable[[date], float], start: date, days: int):
    """Daily (date, level, sd) from `start` for `days` days."""
    out = []
    var = sd ** 2
    d = start
    for _ in range(days):
        d += timedelta(days=1)
        gain = rate * pace(d) / hours_per_level(level)
        level = min(6.0, level + gain)
        # Uncertainty of the projection: random wander plus doubt about the growth model itself.
        var += levels.DAILY_SD ** 2 + (0.35 * gain) ** 2
        out.append((d, level, math.sqrt(var)))
    return out


def needed_hours(level: float, goal: float, rate: float) -> float:
    """Effective hours to go from `level` to `goal` at the given personal rate."""
    total, lv = 0.0, level
    while lv < goal - 1e-9:
        step = min(0.05, goal - lv)
        total += step * hours_per_level(lv) / max(rate, 0.1)
        lv += step
    return total


def _first_reaching(path, target: float) -> str | None:
    for d, lv, _ in path:
        if lv >= target - 1e-6:
            return d.isoformat()
    return None


def forecast(session: Session, plan: StudyPlan | None = None) -> dict:
    est = levels.estimate(session)
    rate = est["rate"]["rate"]
    p = store.profile(session)
    today = date.today()
    try:
        target = date.fromisoformat(p["target_date"])
    except (TypeError, ValueError):
        target = today + timedelta(days=180)
    if plan is None:
        plan = session.exec(select(StudyPlan).where(StudyPlan.active == True)).first()  # noqa: E712
    days_left = max(1, (target - today).days)
    horizon = max(days_left, 120)
    goal = {s: float((plan.goal or {}).get(s) or DEFAULT_GOAL) if plan else DEFAULT_GOAL for s in CORE}
    pace, basis = recent_pace(session)
    scenarios: dict[str, Callable[[date], dict[str, float]]] = {"pace": lambda _d: pace}
    if plan:
        scenarios["plan"] = plan_pace_fn(session, plan)

    skills: dict[str, dict | None] = {}
    series: dict[str, list[dict]] = {name: [] for name in scenarios}
    paths: dict[str, dict[str, list]] = {name: {} for name in scenarios}
    for skill in CORE:
        cur = est["skills"].get(skill)
        if not cur:
            skills[skill] = None
            continue
        info: dict = {"now": cur["level"], "sd": cur["sd"], "goal": goal[skill]}
        for name, fn in scenarios.items():
            path = _project(cur["level"], cur["sd"], rate, lambda d, fn=fn, skill=skill: fn(d)[skill], today, HORIZON_DAYS)
            paths[name][skill] = path
            _, lv, sd = path[days_left - 1]
            info[name] = {
                "at_target": round(lv, 2), "low": round(max(1.0, lv - 1.28 * sd), 2), "high": round(min(6.0, lv + 1.28 * sd), 2),
                "c1": _first_reaching(path, 5.0) if cur["level"] < 5.0 else "reached",
                "c2": _first_reaching(path, 6.0) if cur["level"] < 6.0 else "reached",
                "goal_date": _first_reaching(path, goal[skill]) if cur["level"] < goal[skill] else "reached",
                "hours_per_day": round(fn(today + timedelta(days=1))[skill], 2),
            }
        info["needed_hours_per_day"] = round(needed_hours(cur["level"], goal[skill], rate) / days_left, 2)
        skills[skill] = info

    # Weekly points for the chart (until the target date, at least four months ahead).
    known = [s for s in CORE if skills.get(s)]
    for name in scenarios:
        for i in range(0, horizon, 7):
            row: dict = {"d": (today + timedelta(days=i + 1)).isoformat()}
            for s in known:
                _, lv, sd = paths[name][s][i]
                row[s] = round(lv, 2)
                row[f"{s}_sd"] = round(sd, 2)
            if known:
                row["overall"] = round(sum(row[s] for s in known) / len(known), 2)
            series[name].append(row)

    def overall(name: str) -> float | None:
        vals = [skills[s][name]["at_target"] for s in known if skills[s] and name in skills[s]]
        return round(sum(vals) / len(vals), 2) if vals and len(vals) == len(known) else None

    now_vals = [skills[s]["now"] for s in known]
    return {
        "target_date": target.isoformat(),
        "days_left": days_left,
        "goal": goal,
        "rate": est["rate"],
        "basis": basis,
        "has_plan": plan is not None,
        "skills": skills,
        "overall": {
            "now": round(sum(now_vals) / len(now_vals), 2) if now_vals else None,
            "pace": overall("pace"),
            "plan": overall("plan") if plan else None,
            "goal": round(sum(goal.values()) / 4, 2),
        },
        "series": series,
        "estimate_series": {s: est["series"].get(s, [])[-180:] for s in known},
    }
