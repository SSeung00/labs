"""Convert a planned workout's step structure into a Garmin Connect running workout."""

from __future__ import annotations

from typing import Any

from garminconnect.workout import (
    ConditionType,
    ExecutableStep,
    RepeatGroup,
    RunningWorkout,
    StepType,
    TargetType,
    WorkoutSegment,
    create_repeat_group,
)

from app.analytics import physio

STEP_TYPE = {
    "warmup": (StepType.WARMUP, "warmup", 1),
    "cooldown": (StepType.COOLDOWN, "cooldown", 2),
    "run": (StepType.INTERVAL, "interval", 3),
    "recover": (StepType.RECOVERY, "recovery", 4),
}

NO_TARGET = {"workoutTargetTypeId": TargetType.NO_TARGET, "workoutTargetTypeKey": "no.target", "displayOrder": 1}
PACE_TARGET = {"workoutTargetTypeId": TargetType.PACE_ZONE, "workoutTargetTypeKey": "pace.zone", "displayOrder": 1}


def pace_range_mps(zone: str | None, vdot: float, race_pace_s_per_km: float | None) -> tuple[float, float] | None:
    """(slow, fast) in m/s — Garmin wants the slower speed as the lower limit."""
    if not zone:
        return None
    if zone == "RP":
        if not race_pace_s_per_km:
            return None
        return 1000 / (race_pace_s_per_km + 5), 1000 / (race_pace_s_per_km - 5)
    paces = physio.training_paces(vdot)
    if zone not in paces:
        return None
    z = paces[zone]
    return 1000 / z["slow"], 1000 / z["fast"]


def _executable(step: dict, order: int, vdot: float, rp: float | None) -> ExecutableStep:
    type_id, type_key, disp = STEP_TYPE.get(step["type"], STEP_TYPE["run"])
    if step.get("distance_m"):
        cond = {"conditionTypeId": ConditionType.DISTANCE, "conditionTypeKey": "distance", "displayOrder": 3, "displayable": True}
        value = float(step["distance_m"])
    elif step.get("duration_s"):
        cond = {"conditionTypeId": ConditionType.TIME, "conditionTypeKey": "time", "displayOrder": 2, "displayable": True}
        value = float(step["duration_s"])
    else:
        cond = {"conditionTypeId": ConditionType.LAP_BUTTON, "conditionTypeKey": "lap.button", "displayOrder": 1, "displayable": True}
        value = None
    # Easy warm-ups/recoveries stay untargeted so the watch doesn't nag on them.
    rng = None if step["type"] in ("recover", "warmup", "cooldown") else pace_range_mps(step.get("pace"), vdot, rp)
    return ExecutableStep(
        stepOrder=order,
        stepType={"stepTypeId": type_id, "stepTypeKey": type_key, "displayOrder": disp},
        endCondition=cond,
        endConditionValue=value,
        targetType=PACE_TARGET if rng else NO_TARGET,
        targetValueOne=rng[0] if rng else None,
        targetValueTwo=rng[1] if rng else None,
        description=step.get("note"),
    )


def _steps(steps: list[dict], vdot: float, rp: float | None, counter: list[int]) -> list[ExecutableStep | RepeatGroup]:
    out: list[ExecutableStep | RepeatGroup] = []
    for s in steps:
        counter[0] += 1
        order = counter[0]
        if s["type"] == "repeat":
            children = _steps(s.get("steps", []), vdot, rp, counter)
            out.append(create_repeat_group(int(s.get("reps", 1)), children, order))
        else:
            out.append(_executable(s, order, vdot, rp))
    return out


def estimate_seconds(steps: list[dict], vdot: float, rp: float | None) -> int:
    total = 0.0
    for s in steps:
        if s["type"] == "repeat":
            total += s.get("reps", 1) * estimate_seconds(s.get("steps", []), vdot, rp)
        elif s.get("duration_s"):
            total += s["duration_s"]
        elif s.get("distance_m"):
            rng = pace_range_mps(s.get("pace") or "E", vdot, rp)
            mps = (rng[0] + rng[1]) / 2 if rng else 3.0
            total += s["distance_m"] / mps
    return int(total)


def build(title: str, steps: list[dict], vdot: float, race_pace_s_per_km: float | None, note: str | None = None) -> dict[str, Any]:
    wo = RunningWorkout(
        workoutName=f"RunLab · {title}"[:80],
        estimatedDurationInSecs=estimate_seconds(steps, vdot, race_pace_s_per_km),
        description=note or "RunLab 훈련 계획에서 보낸 워크아웃",
        workoutSegments=[
            WorkoutSegment(
                segmentOrder=1,
                sportType={"sportTypeId": 1, "sportTypeKey": "running", "displayOrder": 1},
                workoutSteps=_steps(steps, vdot, race_pace_s_per_km, [0]),
            )
        ],
    )
    return wo.to_dict()
