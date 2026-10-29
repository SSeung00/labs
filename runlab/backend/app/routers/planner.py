from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlmodel import col, delete, select

from app.analytics import progress as progress_mod
from app.analytics import readiness as readiness_mod
from app.db import SessionDep
from app.models import Activity, GoalRace, Plan, PlannedWorkout
from app.planner import edit as edit_mod
from app.planner import generator as gen
from app.planner import races as races_mod
from app.planner import weekly_check
from app.planner.review import review as review_workout
from app.planner.service import active_plan, easy_version, plan_view, suggestions

router = APIRouter(tags=["planner"])


# ── Goal races ────────────────────────────────────────────────────────


class RaceBody(BaseModel):
    name: str
    race_day: date
    distance_m: float
    target_time_s: float | None = None
    priority: str = "A"
    location: str | None = None
    note: str | None = None


def _check_race(body: RaceBody) -> None:
    if body.priority not in ("A", "B", "C"):
        raise HTTPException(400, "중요도는 A, B, C 중 하나예요.")
    if not 400 <= body.distance_m <= 250_000:
        raise HTTPException(400, "거리를 확인해 주세요.")


@router.get("/races")
def list_races(session: SessionDep) -> list[dict]:
    return races_mod.list_view(session, active_plan(session))


@router.post("/races")
def create_race(body: RaceBody, session: SessionDep) -> dict:
    _check_race(body)
    r = GoalRace(**body.model_dump())
    session.add(r)
    session.commit()
    session.refresh(r)
    return races_mod.race_view(session, r, active_plan(session), races_mod.current_vdot(session))


@router.patch("/races/{race_id}")
def patch_race(race_id: int, body: dict[str, Any], session: SessionDep) -> dict:
    r = session.get(GoalRace, race_id)
    if not r:
        raise HTTPException(404, "레이스를 찾을 수 없습니다.")
    merged = RaceBody(**{**r.model_dump(), **body})
    _check_race(merged)
    moved = merged.race_day != r.race_day or merged.distance_m != r.distance_m
    for k, v in merged.model_dump().items():
        setattr(r, k, v)
    if moved:
        r.result_activity_id = None
    session.add(r)
    session.commit()
    if moved:
        races_mod.unlink(session, r)  # old race-day workout → rest; re-apply from the plan
    session.refresh(r)
    return races_mod.race_view(session, r, active_plan(session), races_mod.current_vdot(session))


@router.delete("/races/{race_id}")
def delete_race(race_id: int, session: SessionDep) -> dict:
    r = session.get(GoalRace, race_id)
    if r:
        races_mod.unlink(session, r)
        for p in session.exec(select(Plan).where(Plan.goal_race_id == race_id)):
            p.goal_race_id = None
            session.add(p)
        session.delete(r)
        session.commit()
    return {"ok": True}


# ── Plans ─────────────────────────────────────────────────────────────


class PlanBody(BaseModel):
    race: RaceBody
    race_id: int | None = None  # build around a saved race instead of creating a new one
    start_day: date | None = None
    days_per_week: int = 5
    long_run_dow: int = 6
    current_weekly_km: float | None = None
    peak_weekly_km: float | None = None


def _recent_weekly_km(session: SessionDep, weeks: int = 4) -> float:
    since = datetime.combine(date.today() - timedelta(weeks=weeks), datetime.min.time())
    dist = session.exec(select(Activity.distance_m).where(col(Activity.sport).contains("run"), Activity.start_time >= since)).all()
    return round(sum(dist) / 1000 / weeks, 1)


def _params(body: PlanBody, session: SessionDep) -> gen.PlanParams:
    pts = progress_mod.vdot_points(session)
    series = progress_mod.fitness_series(session)
    vdot = progress_mod.current_state(session, pts, series)["vdot"] or 40
    return gen.PlanParams(
        race_distance_m=body.race.distance_m,
        race_day=body.race.race_day,
        start_day=body.start_day or gen.default_start(),
        days_per_week=body.days_per_week,
        long_run_dow=body.long_run_dow,
        current_weekly_km=body.current_weekly_km or _recent_weekly_km(session) or 20,
        peak_weekly_km=body.peak_weekly_km,
        vdot=vdot,
        goal_time_s=body.race.target_time_s,
    )


@router.get("/plans/defaults")
def plan_defaults(session: SessionDep) -> dict:
    pts = progress_mod.vdot_points(session)
    series = progress_mod.fitness_series(session)
    cur = progress_mod.current_state(session, pts, series)
    return {"start_day": gen.default_start().isoformat(), "current_weekly_km": _recent_weekly_km(session), "vdot": cur["vdot"]}


@router.post("/plans/preview")
def preview_plan(body: PlanBody, session: SessionDep) -> dict:
    p = _params(body, session)
    try:
        workouts, weeks = gen.generate(p)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return {
        "params": {**p.__dict__, "race_day": p.race_day.isoformat(), "start_day": p.start_day.isoformat()},
        "weeks": weeks,
        "workouts": [{**w.__dict__, "day": w.day.isoformat()} for w in workouts],
        "race_pace_s_per_km": round(gen.race_pace_s_per_km(p), 1),
    }


@router.post("/plans")
def create_plan(body: PlanBody, session: SessionDep) -> dict:
    p = _params(body, session)
    try:
        workouts, weeks = gen.generate(p)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    race = session.get(GoalRace, body.race_id) if body.race_id else None
    if race is None:
        race = GoalRace(**body.race.model_dump())
    else:
        for k, v in body.race.model_dump(exclude={"location", "note"}).items():
            setattr(race, k, v)
    race.priority = "A"
    session.add(race)
    session.flush()
    for old in session.exec(select(Plan).where(Plan.active.is_(True))):
        old.active = False
        session.add(old)
    plan = Plan(
        name=f"{body.race.name} 플랜",
        goal_race_id=race.id,
        start_day=p.start_day,
        end_day=p.race_day,
        params={
            "days_per_week": p.days_per_week,
            "long_run_dow": p.long_run_dow,
            "current_weekly_km": p.current_weekly_km,
            "peak_weekly_km": p.peak_weekly_km,
            "vdot_at_creation": p.vdot,
            "race_distance_m": p.race_distance_m,
            "goal_time_s": p.goal_time_s,
            "race_pace_s_per_km": round(gen.race_pace_s_per_km(p), 1),
            "weeks": weeks,
        },
        active=True,
    )
    session.add(plan)
    session.flush()
    for w in workouts:
        session.add(PlannedWorkout(
            plan_id=plan.id, day=w.day, kind=w.kind, title=w.title, phase=w.phase,
            target_distance_m=w.target_distance_m, target_tss=w.target_tss, structure=w.structure, note=w.note,
            race_id=race.id if w.kind == "race" else None,
        ))
    session.commit()
    # Other saved races inside the plan period get their mini-taper / recovery right away.
    vdot = p.vdot
    for other in session.exec(select(GoalRace).where(GoalRace.id != race.id)).all():
        races_mod.apply(session, plan, other, vdot=vdot)
    session.refresh(plan)
    return plan_view(session, plan)


@router.get("/plans/races")
def plan_races(session: SessionDep) -> list[dict]:
    """Saved races inside the active plan's period, with what folding each in would change."""
    plan = active_plan(session)
    return races_mod.plan_races(session, plan) if plan else []


class ApplyRacesBody(BaseModel):
    race_ids: list[int]


@router.post("/plans/races/apply")
def apply_races(body: ApplyRacesBody, session: SessionDep) -> dict:
    plan = active_plan(session)
    if not plan:
        raise HTTPException(400, "활성 플랜이 없습니다.")
    vdot = races_mod.current_vdot(session)
    n = 0
    for rid in body.race_ids:
        r = session.get(GoalRace, rid)
        if r:
            n += races_mod.apply(session, plan, r, vdot=vdot)
    return {"changed": n}


@router.get("/plans/active")
def get_active(session: SessionDep) -> dict | None:
    plan = active_plan(session)
    if not plan:
        return None
    view = plan_view(session, plan)
    view["race"] = session.get(GoalRace, plan.goal_race_id) if plan.goal_race_id else None
    return view


@router.delete("/plans/{plan_id}")
def delete_plan(plan_id: int, session: SessionDep) -> dict:
    plan = session.get(Plan, plan_id)
    if plan:
        session.exec(delete(PlannedWorkout).where(PlannedWorkout.plan_id == plan_id))
        session.delete(plan)
        session.commit()
    return {"ok": True}


# ── Workouts ──────────────────────────────────────────────────────────


class WorkoutPatch(BaseModel):
    day: date | None = None
    kind: str | None = None
    title: str | None = None
    target_distance_m: float | None = None
    structure: list[dict] | None = None
    note: str | None = None
    status: str | None = None  # planned | skipped


@router.patch("/workouts/{wid}")
def patch_workout(wid: int, body: WorkoutPatch, session: SessionDep) -> PlannedWorkout:
    w = session.get(PlannedWorkout, wid)
    if not w:
        raise HTTPException(404, "훈련을 찾을 수 없습니다.")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(w, k, v)
    if body.kind == "easy" and body.structure is None:
        easy_version(w)
    if body.kind == "rest":
        w.title, w.target_distance_m, w.structure, w.target_tss = "휴식", 0, [], 0
    session.add(w)
    session.commit()
    session.refresh(w)
    return w


class WorkoutCreate(BaseModel):
    day: date
    kind: str = "easy"
    title: str = "이지런"
    target_distance_m: float = 5000


@router.post("/workouts")
def create_workout(body: WorkoutCreate, session: SessionDep) -> PlannedWorkout:
    plan = active_plan(session)
    if not plan:
        raise HTTPException(400, "활성 플랜이 없습니다.")
    w = PlannedWorkout(plan_id=plan.id, **body.model_dump(), structure=[{"type": "run", "distance_m": body.target_distance_m, "pace": "E"}])
    w.target_tss = round(body.target_distance_m / 1000 * 5.4 / 60 * 0.72**2 * 100, 1)
    session.add(w)
    session.commit()
    session.refresh(w)
    return w


@router.delete("/workouts/{wid}")
def delete_workout(wid: int, session: SessionDep) -> dict:
    w = session.get(PlannedWorkout, wid)
    if w:
        session.delete(w)
        session.commit()
    return {"ok": True}


@router.get("/workouts/templates")
def workout_templates() -> list[dict]:
    return [{"key": k, "label": label} for k, (label, _) in edit_mod.TEMPLATES.items()] + [{"key": "rest", "label": "휴식"}]


class TemplateBody(BaseModel):
    template: str
    km: float = 8


@router.post("/workouts/{wid}/template")
def set_workout_template(wid: int, body: TemplateBody, session: SessionDep) -> PlannedWorkout:
    w = session.get(PlannedWorkout, wid)
    if not w:
        raise HTTPException(404, "훈련을 찾을 수 없습니다.")
    if w.kind == "race":
        raise HTTPException(400, "대회는 대회 일정에서 바꿔 주세요.")
    plan = session.get(Plan, w.plan_id) if w.plan_id else None
    if not plan:
        raise HTTPException(400, "플랜에 속한 훈련이 아니에요.")
    try:
        edit_mod.set_template(edit_mod.plan_params(session, plan), w, body.template, body.km)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    session.add(w)
    session.commit()
    session.refresh(w)
    return w


class SwapBody(BaseModel):
    day: date


@router.post("/workouts/{wid}/swap")
def swap_workout(wid: int, body: SwapBody, session: SessionDep) -> dict:
    w = session.get(PlannedWorkout, wid)
    if not w:
        raise HTTPException(404, "훈련을 찾을 수 없습니다.")
    try:
        n = edit_mod.swap(session, w, body.day)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return {"moved": n}


@router.get("/workouts/{wid}/review")
def workout_review(wid: int, session: SessionDep) -> dict:
    w = session.get(PlannedWorkout, wid)
    if not w:
        raise HTTPException(404, "훈련을 찾을 수 없습니다.")
    return review_workout(session, w)


class WeekBody(BaseModel):
    week_start: date
    action: str  # lighter | recovery
    dry_run: bool = True


@router.post("/plans/week")
def adjust_week(body: WeekBody, session: SessionDep) -> dict:
    plan = active_plan(session)
    if not plan:
        raise HTTPException(400, "활성 플랜이 없습니다.")
    monday = body.week_start - timedelta(days=body.week_start.weekday())
    try:
        if body.dry_run:
            return {"changes": edit_mod.week_changes(session, plan, monday, body.action)}
        return {"changed": edit_mod.apply_week(session, plan, monday, body.action)}
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


class RegenBody(BaseModel):
    days_per_week: int
    long_run_dow: int
    peak_weekly_km: float | None = None
    dry_run: bool = True


@router.post("/plans/regenerate")
def regenerate_plan(body: RegenBody, session: SessionDep) -> dict:
    plan = active_plan(session)
    if not plan:
        raise HTTPException(400, "활성 플랜이 없습니다.")
    try:
        return edit_mod.regenerate(session, plan, body.days_per_week, body.long_run_dow, body.peak_weekly_km, body.dry_run)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.get("/plans/check")
def get_plan_check(session: SessionDep) -> dict | None:
    """Weekly check: how the last two weeks went and what to change in the coming one."""
    from app.analytics.snapshots import ensure_today

    plan = active_plan(session)
    if not plan:
        return None
    ensure_today(session)  # the goal trend reads the daily snapshots
    return weekly_check.check(session, plan)


@router.post("/plans/check/apply")
def apply_plan_check(session: SessionDep) -> dict:
    plan = active_plan(session)
    if not plan:
        raise HTTPException(400, "활성 플랜이 없습니다.")
    return {"changed": weekly_check.apply(session, plan)}


@router.post("/plans/check/dismiss")
def dismiss_plan_check(session: SessionDep) -> dict:
    plan = active_plan(session)
    if not plan:
        raise HTTPException(400, "활성 플랜이 없습니다.")
    weekly_check.set_status(session, weekly_check.target_week(date.today()), "dismissed")
    return {"ok": True}


@router.get("/plans/suggestions")
def get_suggestions(session: SessionDep) -> list[dict]:
    return suggestions(session, readiness_mod.compute(session))


class ApplyBody(BaseModel):
    workout_id: int
    type: str


@router.post("/plans/suggestions/apply")
def apply_suggestion(body: ApplyBody, session: SessionDep) -> dict:
    w = session.get(PlannedWorkout, body.workout_id)
    if not w:
        raise HTTPException(404, "훈련을 찾을 수 없습니다.")
    today = date.today()
    if body.type == "convert_easy":
        easy_version(w)
    elif body.type == "move_tomorrow":
        w.day = today + timedelta(days=1)
    elif body.type == "move_today":
        # Today's planned session (if any) becomes easy so the week's load stays sane.
        for t in session.exec(select(PlannedWorkout).where(PlannedWorkout.plan_id == w.plan_id, PlannedWorkout.day == today)):
            if t.id != w.id and t.kind not in ("rest", "easy"):
                easy_version(t)
                session.add(t)
        w.day = today
    elif body.type == "skip":
        w.status = "skipped"
    else:
        raise HTTPException(400, "알 수 없는 동작")
    session.add(w)
    session.commit()
    return {"ok": True}


@router.post("/workouts/{wid}/garmin")
def send_to_garmin(wid: int, session: SessionDep) -> dict:
    """Upload this workout to Garmin Connect and schedule it on its planned date."""
    from app.ingest.garmin_auth import GarminAuthError, garmin_auth
    from app.planner.garmin_workout import build

    w = session.get(PlannedWorkout, wid)
    if not w:
        raise HTTPException(404, "훈련을 찾을 수 없습니다.")
    if w.kind == "rest" or not w.structure:
        raise HTTPException(400, "보낼 구성이 없는 훈련이에요.")
    plan = session.get(Plan, w.plan_id) if w.plan_id else None
    pts = progress_mod.vdot_points(session)
    vdot = progress_mod.current_state(session, pts, progress_mod.fitness_series(session))["vdot"] or 40
    rp = (plan.params or {}).get("race_pace_s_per_km") if plan else None
    payload = build(w.title, w.structure, vdot, rp, w.note)
    try:
        g = garmin_auth.client()
        created = g.upload_workout(payload)
        workout_id = created.get("workoutId")
        g.schedule_workout(workout_id, w.day.isoformat())
    except GarminAuthError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"가민에 보내지 못했어요: {e}") from e
    w.garmin_workout_id = workout_id
    session.add(w)
    session.commit()
    return {"ok": True, "garmin_workout_id": workout_id}
