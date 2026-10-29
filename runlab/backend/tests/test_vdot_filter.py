from datetime import date, timedelta

from app.analytics.vdot_filter import Run, run_filter

D0 = date(2026, 1, 1)


def _easy(day: int, vhr: float, kind: str = "easy") -> Run:
    return Run(D0 + timedelta(days=day), kind, vhr, None, False)


def test_race_sets_the_level_and_one_bad_day_barely_moves_it():
    runs = [_easy(i, 48.0) for i in range(0, 40, 2)]
    runs.append(Run(D0 + timedelta(days=41), "race", 49.0, 45.0, True))  # HR estimates read ~4 high
    after_race = [_easy(i, 49.0) for i in range(43, 60, 2)]
    bad = _easy(61, 38.0)
    df = run_filter(runs + after_race + [bad], until=D0 + timedelta(days=62)).set_index("day")
    v_race = df.loc[str(D0 + timedelta(days=41)), "v"]
    assert 44.0 < v_race < 46.5  # the race pulls the estimate close to its own VDOT
    v_before_bad = df.loc[str(D0 + timedelta(days=60)), "v"]
    v_after_bad = df.loc[str(D0 + timedelta(days=61)), "v"]
    assert abs(v_after_bad - v_before_bad) < 0.8
    assert df["bias"].iloc[-1] > 0.5  # learned that HR estimates read high


def test_hard_training_effort_only_pulls_up():
    base = [_easy(i, 45.0) for i in range(0, 30, 2)]
    slow_effort = Run(D0 + timedelta(days=31), "workout", None, 35.0, False)
    fast_effort = Run(D0 + timedelta(days=33), "workout", None, 48.0, False)
    df = run_filter(base + [slow_effort, fast_effort], until=D0 + timedelta(days=34)).set_index("day")
    v30 = df.loc[str(D0 + timedelta(days=30)), "v"]
    assert abs(df.loc[str(D0 + timedelta(days=31)), "v"] - v30) < 1e-9  # a slow effort says nothing
    assert df.loc[str(D0 + timedelta(days=33)), "v"] > v30 + 0.5


def test_uncertainty_grows_without_runs():
    runs = [_easy(i, 45.0) for i in range(0, 20, 2)]
    df = run_filter(runs, until=D0 + timedelta(days=60))
    assert df["sd"].iloc[-1] > df["sd"].iloc[19] * 1.5


def test_outlier_race_is_ignored():
    runs = [_easy(i, 46.0) for i in range(0, 40, 2)]
    runs.append(Run(D0 + timedelta(days=41), "race", 40.0, 25.0, True))  # a trail race, not a road PR
    df = run_filter(runs, until=D0 + timedelta(days=41)).set_index("day")
    assert df.loc[str(D0 + timedelta(days=41)), "v"] > 42
