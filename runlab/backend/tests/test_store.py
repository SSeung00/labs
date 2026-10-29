from sqlmodel import Session, select

from app.db import engine, init_db
from app.ingest.fit_parser import parse_fit
from app.ingest.store import load_stream, save_activity
from app.models import Activity, Lap
from tests.fit_factory import make_run_fit


def test_save_is_idempotent_and_keeps_user_fields():
    init_db()
    parsed = parse_fit(make_run_fit(seconds=120))
    with Session(engine) as s:
        act, created = save_activity(s, {**parsed.summary, "garmin_id": 42}, parsed.laps, parsed.stream)
        assert created and act.has_stream
        act.rpe = 7
        s.add(act)
        s.commit()

        again, created2 = save_activity(s, {**parsed.summary, "garmin_id": 42, "rpe": None}, parsed.laps, parsed.stream)
        assert not created2 and again.id == act.id and again.rpe == 7
        assert len(s.exec(select(Activity).where(Activity.garmin_id == 42)).all()) == 1
        assert len(s.exec(select(Lap).where(Lap.activity_id == act.id)).all()) == 2

    df = load_stream(act.id)
    assert df is not None and len(df) == 121
