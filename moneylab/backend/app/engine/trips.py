"""Which trip a spending row belongs to.

- During the trip (start..end): every spending row except fixed costs (구독, 보험 …).
- Before the trip: flights and lodging (TRAVEL_BOOKING) booked ahead, within PREBOOK_DAYS,
  as long as no earlier trip sits in between. Events (학회·단체 행사) only take what happens
  during them: bookings for them are usually 정산 rows, and they shouldn't swallow the
  bookings for a real trip that comes after.
"""

from dataclasses import dataclass
from datetime import date, timedelta

from app.engine.categories import TRAVEL_BOOKING

PREBOOK_DAYS = 365  # flights for a big trip are often booked most of a year ahead


@dataclass
class TripWindow:
    id: int
    start: date
    end: date
    event: bool = False


def assign_trip(day: date, category: str, fixed_categories: set[str],
                trips: list[TripWindow]) -> int | None:
    """trips must be sorted by start date."""
    if category not in fixed_categories:
        for t in trips:
            if t.start <= day <= t.end:
                return t.id
    if category not in TRAVEL_BOOKING:
        return None
    prev_end: date | None = None
    for t in trips:
        if t.event:
            continue
        if day < t.start:
            after_prev = prev_end is None or day > prev_end
            if after_prev and day >= t.start - timedelta(days=PREBOOK_DAYS):
                return t.id
            return None
        prev_end = t.end if prev_end is None else max(prev_end, t.end)
    return None
