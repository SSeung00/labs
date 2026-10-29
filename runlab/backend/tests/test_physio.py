import numpy as np
import pytest

from app.analytics import physio


@pytest.mark.parametrize(
    ("dist", "time_s", "vdot"),
    [
        # Daniels' Running Formula table values
        (5000, 30 * 60 + 40, 30),
        (5000, 19 * 60 + 57, 50),
        (10000, 41 * 60 + 21, 50),
        (42195, 3 * 3600 + 10 * 60 + 49, 50),
        (5000, 14 * 60 + 55, 70),
    ],
)
def test_vdot_matches_daniels_tables(dist, time_s, vdot):
    assert physio.vdot_from_race(dist, time_s) == pytest.approx(vdot, abs=0.4)


def test_race_time_inverse():
    for d in (5000, 21097.5, 42195):
        t = physio.race_time_for_vdot(d, 52.3)
        assert physio.vdot_from_race(d, t) == pytest.approx(52.3, abs=1e-6)


def test_training_paces_ordering():
    p = physio.training_paces(50)
    assert p["E"]["slow"] > p["E"]["fast"] > p["M"]["fast"] > p["T"]["fast"] > p["I"]["fast"] > p["R"]["fast"]
    # VDOT 50 threshold ≈ 4:15/km in Daniels' tables
    assert p["T"]["fast"] == pytest.approx(255, abs=10)


def test_minetti_flat_and_hills():
    assert physio.minetti_cost(np.array([0.0]))[0] == pytest.approx(3.6)
    up, down = physio.minetti_cost(np.array([0.1, -0.1]))
    assert up > 3.6 > down


def test_trimp_one_hour_at_threshold_is_100_tss_reference():
    hr = np.full(3600, 170.0)
    dt = np.ones(3600)
    t = physio.banister_trimp(hr, dt, rest_hr=50, max_hr=190)
    assert t == pytest.approx(physio.trimp_per_hour_at(170, 50, 190), rel=1e-6)


def test_vdot_from_hr_rejects_easy_and_artefacts():
    assert physio.vdot_from_hr(3.0, 100, 190) is None  # too easy
    v = physio.vdot_from_hr(3.33, 165, 190)
    assert v is not None and 40 < v < 70
