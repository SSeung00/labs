"""Historical weather at an activity's start point via Open-Meteo (free, no key)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
HOURLY = "temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,wind_speed_10m,precipitation"


def fetch_weather(lat: float, lon: float, start_utc: datetime, client: httpx.Client) -> dict | None:
    day = start_utc.date().isoformat()
    # The archive lags a few days; recent dates come from the forecast API.
    recent = datetime.now(UTC).replace(tzinfo=None) - start_utc < timedelta(days=7)
    params = {
        "latitude": round(lat, 3),  # ~100 m; enough for weather, less precise than GPS
        "longitude": round(lon, 3),
        "hourly": HOURLY,
        "timezone": "UTC",
        "start_date": day,
        "end_date": day,
        "wind_speed_unit": "ms",
    }
    res = client.get(FORECAST_URL if recent else ARCHIVE_URL, params=params, timeout=15)
    res.raise_for_status()
    hourly = res.json().get("hourly") or {}
    times = hourly.get("time") or []
    if not times:
        return None
    target = start_utc.replace(minute=0, second=0, microsecond=0)
    idx = min(range(len(times)), key=lambda i: abs(datetime.fromisoformat(times[i]) - target))

    def pick(key: str):
        vals = hourly.get(key) or []
        return vals[idx] if idx < len(vals) else None

    return {
        "temp_c": pick("temperature_2m"),
        "feels_like_c": pick("apparent_temperature"),
        "humidity_pct": pick("relative_humidity_2m"),
        "dew_point_c": pick("dew_point_2m"),
        "wind_mps": pick("wind_speed_10m"),
        "precip_mm": pick("precipitation"),
        "source": "open-meteo",
    }
