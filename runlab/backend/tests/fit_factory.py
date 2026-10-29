"""Build small synthetic FIT activity files for tests (fit-tool is a dev dependency)."""

from datetime import UTC, datetime

from fit_tool.fit_file_builder import FitFileBuilder
from fit_tool.profile.messages.activity_message import ActivityMessage
from fit_tool.profile.messages.file_id_message import FileIdMessage
from fit_tool.profile.messages.lap_message import LapMessage
from fit_tool.profile.messages.record_message import RecordMessage
from fit_tool.profile.messages.session_message import SessionMessage
from fit_tool.profile.profile_type import FileType, Manufacturer, Sport, SubSport

FIT_EPOCH_S = 631065600  # 1989-12-31T00:00:00Z


def make_run_fit(
    start: datetime = datetime(2026, 9, 1, 21, 0, tzinfo=UTC),
    seconds: int = 600,
    speed: float = 3.0,
    utc_offset_h: int = 9,
) -> bytes:
    start_ms = int(start.timestamp() * 1000)
    end_ms = start_ms + seconds * 1000
    builder = FitFileBuilder(auto_define=True)

    fid = FileIdMessage()
    fid.type = FileType.ACTIVITY
    fid.manufacturer = Manufacturer.GARMIN.value
    fid.time_created = start_ms
    fid.serial_number = 1234
    builder.add(fid)

    for i in range(seconds + 1):
        r = RecordMessage()
        r.timestamp = start_ms + i * 1000
        r.position_lat = 37.5 + i * 1e-5
        r.position_long = 127.0
        r.distance = speed * i
        r.enhanced_speed = speed
        r.heart_rate = 140 + (i % 10)
        r.cadence = 85
        r.enhanced_altitude = 30.0
        builder.add(r)

    half = seconds // 2
    for k in range(2):
        lap = LapMessage()
        lap.timestamp = start_ms + (k + 1) * half * 1000
        lap.start_time = start_ms + k * half * 1000
        lap.total_elapsed_time = half
        lap.total_timer_time = half
        lap.total_distance = speed * half
        lap.avg_heart_rate = 144
        lap.enhanced_avg_speed = speed
        lap.avg_running_cadence = 85
        builder.add(lap)

    s = SessionMessage()
    s.timestamp = end_ms
    s.start_time = start_ms
    s.sport = Sport.RUNNING
    s.sub_sport = SubSport.GENERIC
    s.total_elapsed_time = seconds
    s.total_timer_time = seconds
    s.total_distance = speed * seconds
    s.avg_heart_rate = 144
    s.max_heart_rate = 149
    s.enhanced_avg_speed = speed
    s.avg_running_cadence = 85
    s.start_position_lat = 37.5
    s.start_position_long = 127.0
    builder.add(s)

    a = ActivityMessage()
    a.timestamp = end_ms
    a.total_timer_time = seconds
    a.num_sessions = 1
    a.local_timestamp = end_ms // 1000 - FIT_EPOCH_S + utc_offset_h * 3600
    builder.add(a)

    return builder.build().to_bytes()
