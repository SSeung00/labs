import io
import zipfile
from datetime import datetime

import pytest

from app.ingest.fit_parser import iter_fit_payloads, parse_fit
from tests.fit_factory import make_run_fit


def test_parse_run_summary_laps_stream():
    parsed = parse_fit(make_run_fit(seconds=600, speed=3.0))
    s = parsed.summary

    assert s["sport"] == "running"
    assert s["start_time_utc"] == datetime(2026, 9, 1, 21, 0)
    assert s["start_time"] == datetime(2026, 9, 2, 6, 0)  # +09:00 local
    assert s["distance_m"] == pytest.approx(1800, abs=1)
    assert s["avg_cadence"] == 170  # per-foot 85 doubled
    assert s["start_lat"] == pytest.approx(37.5, abs=1e-4)

    assert len(parsed.laps) == 2
    assert parsed.laps[0]["duration_s"] == pytest.approx(300)

    df = parsed.stream
    assert df is not None and len(df) == 601
    assert df["t"].iloc[-1] == pytest.approx(600)
    assert df["cad"].iloc[0] == pytest.approx(170)
    assert df["lat"].iloc[0] == pytest.approx(37.5, abs=1e-4)
    assert "power" not in df.columns  # never recorded → dropped


def test_nested_zip_payloads():
    fit = make_run_fit(seconds=60)
    inner = io.BytesIO()
    with zipfile.ZipFile(inner, "w") as z:
        z.writestr("123_ACTIVITY.fit", fit)
    outer = io.BytesIO()
    with zipfile.ZipFile(outer, "w") as z:
        z.writestr("DI_CONNECT/DI-Connect-Uploaded-Files/UploadedFiles_0-_Part1.zip", inner.getvalue())
        z.writestr("readme.txt", b"ignored")

    found = list(iter_fit_payloads("export.zip", outer.getvalue()))
    assert [n for n, _ in found] == ["123_ACTIVITY.fit"]
    assert parse_fit(found[0][1]).summary["duration_s"] == pytest.approx(60)


def test_garbage_rejected():
    with pytest.raises(Exception):  # noqa: B017  (fitdecode raises its own error types)
        parse_fit(b"not a fit file")
