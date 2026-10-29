"""Import the user's own activity/shoe spreadsheet (Type, Date, Title, Distance, …, Shoe, Shoe Cum Dist).

For each row we find the matching synced activity (start within ±5 min, distance within 5%) and:
- assign the shoe (creating Gear rows on first sight, with brand/colour guesses),
- adopt the spreadsheet title when the Garmin name is generic ("Running"),
- mark race rows (Type ≠ Train) as races, source "import".
"""

from __future__ import annotations

import csv
import io
import re
from datetime import date, datetime, timedelta

from sqlmodel import Session, col, select

from app.analytics.run_type import is_generic
from app.models import Activity, Gear

# name fragment → (brand, primary colour, secondary colour, retire km)
SHOE_HINTS: list[tuple[str, tuple[str, str, str, int]]] = [
    ("1080 V15 B", ("New Balance", "#1f2937", "#9ca3af", 700)),
    ("1080 V15 W", ("New Balance", "#f5f5f4", "#94a3b8", 700)),
    ("SC Elite", ("New Balance", "#f97316", "#facc15", 400)),
    ("Adios Pro", ("adidas", "#22d3ee", "#a3e635", 400)),
    ("Evo SL", ("adidas", "#f8fafc", "#ef4444", 600)),
    ("Boston", ("adidas", "#2563eb", "#f8fafc", 700)),
    ("Cloudmonster", ("On", "#111827", "#ea580c", 700)),
    ("Ultra Glide", ("Salomon", "#0f766e", "#fde047", 600)),
    ("Bondi", ("HOKA", "#1e3a8a", "#38bdf8", 700)),
]


def _hint(name: str):
    for frag, h in SHOE_HINTS:
        if frag.lower() in name.lower():
            return h
    return (None, "#ff6a3d", None, 700)


def shoe_key(name: str) -> str:
    """Loose identity for shoe names: "Adizero Evo SL" == "EVO SL", "1080 V15 B" == "1080 V15 (Black)"."""
    n = name.lower().strip()
    n = re.sub(r"\s+b$", " black", n)
    n = re.sub(r"\s+w$", "", n)
    n = re.sub(r"^(adizero|adidas|new balance|nb|hoka|on|asics|salomon)\s+", "", n)
    return re.sub(r"[^a-z0-9]", "", n)


def _f(v: str) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse(text: str) -> list[dict]:
    rows = []
    for r in csv.DictReader(io.StringIO(text.lstrip("﻿"))):
        try:
            when = datetime.strptime(r["Date"].strip(), "%Y-%m-%d, %H:%M")
        except (KeyError, ValueError):
            continue
        rows.append({
            "type": (r.get("Type") or "").strip(),
            "when": when,
            "title": (r.get("Title") or "").strip(),
            "km": _f(r.get("Distance")),
            "shoe": (r.get("Shoe") or "").strip(),
            "cum": _f(r.get("Shoe Cum Dist")),
        })
    return rows


def import_csv(session: Session, text: str) -> dict:
    rows = parse(text)
    runs = session.exec(select(Activity).where(col(Activity.sport).contains("run") | (Activity.name.contains("HYROX")))).all()
    # Index by date for quick candidate lookup.
    by_day: dict[date, list[Activity]] = {}
    for a in runs:
        by_day.setdefault(a.start_time.date(), []).append(a)

    existing = {shoe_key(g.name): g for g in session.exec(select(Gear))}
    gear: dict[str, Gear] = {}
    first_use: dict[str, dict] = {}
    for r in sorted(rows, key=lambda r: r["when"]):
        if r["shoe"] and r["shoe"] not in first_use:
            first_use[r["shoe"]] = r

    created = []
    for name, r in first_use.items():
        if shoe_key(name) in existing:
            gear[name] = existing[shoe_key(name)]
            continue
        brand, c1, c2, retire = _hint(name)
        initial = max(0.0, round((r["cum"] or 0) - (r["km"] or 0), 2))
        g = Gear(name=name, brand=brand, color=c1, color2=c2, retire_at_km=retire, initial_km=initial, purchased_on=r["when"].date())
        session.add(g)
        session.flush()
        gear[name] = g
        created.append(name)

    matched, unmatched, renamed, races = 0, [], 0, 0
    used: set[int] = set()
    for r in rows:
        cands = by_day.get(r["when"].date(), []) + by_day.get((r["when"] - timedelta(days=1)).date(), [])
        best = None
        for a in cands:
            if a.id in used:
                continue
            dt = abs((a.start_time - r["when"]).total_seconds())
            km = (a.distance_m or 0) / 1000
            close = dt <= 300 and r["km"] and abs(km - r["km"]) <= max(0.15, 0.05 * r["km"])
            if close and (best is None or dt < best[0]):
                best = (dt, a)
        if not best:
            unmatched.append(f"{r['when']:%Y-%m-%d %H:%M} {r['title']} {r['km']}km")
            continue
        a = best[1]
        used.add(a.id)
        matched += 1
        if r["shoe"] in gear:
            a.shoe_id = gear[r["shoe"]].id
        if r["title"] and is_generic(a.name):
            a.name = r["title"]
            renamed += 1
        if r["type"] and r["type"].lower() != "train" and a.run_type_source != "manual":
            a.run_type, a.run_type_source, a.run_type_confidence = "race", "import", 1.0
            a.run_type_reason = f"기록표 구분: {r['type']}"
            races += 1
        session.add(a)

    # Shoes past their retirement distance and unused for 6 months are retired.
    cutoff = datetime.now() - timedelta(days=180)
    for name, g in gear.items():
        last = max((r["when"] for r in rows if r["shoe"] == name), default=None)
        total = max((r["cum"] or 0 for r in rows if r["shoe"] == name), default=0)
        if last and last < cutoff and total >= g.retire_at_km:
            g.retired = True
            session.add(g)
    session.commit()
    return {
        "rows": len(rows),
        "matched": matched,
        "unmatched": unmatched,
        "shoes_created": created,
        "renamed": renamed,
        "races": races,
    }
