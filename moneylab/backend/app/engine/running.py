"""Running costs, joined with RunLab's own data (read-only).

RunLab lives next to MoneyLab and keeps its activities in its own SQLite file. We only read
it: monthly kilometres, shoes (with their mileage) and goal races. Purchases are tied to a
shoe or race in MoneyLab's RunLink table, which gives cost per km per shoe.
"""

import os
import sqlite3
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

from sqlmodel import Session, col, select

from app.config import ROOT_DIR
from app.engine.categories import family
from app.models import RunLink, Txn

RUNLAB_DB = Path(os.environ.get("MONEYLAB_RUNLAB_DB") or ROOT_DIR.parent / "runlab" / "data" / "runlab.db")


def _ro(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)


def runlab_data(path: Path = RUNLAB_DB) -> dict | None:
    if not path.exists():
        return None
    try:
        con = _ro(path)
    except sqlite3.Error:
        return None
    try:
        km = {m: round(v / 1000, 1) for m, v in con.execute(
            "select strftime('%Y-%m', start_time), sum(distance_m) from activity "
            "where sport like '%run%' group by 1"
        )}
        shoes = []
        for gid, name, brand, bought, retired, initial in con.execute(
            "select id, name, brand, purchased_on, retired, initial_km from gear order by retired, id"
        ):
            run_km = con.execute(
                "select coalesce(sum(distance_m), 0) from activity where shoe_id = ?", (gid,)
            ).fetchone()[0] / 1000
            shoes.append({"id": gid, "name": name, "brand": brand, "purchased_on": bought,
                          "retired": bool(retired), "km": round((initial or 0) + run_km, 1)})
        races = [{"id": rid, "name": name, "race_day": day, "distance_km": round(dist / 1000, 2)}
                 for rid, name, day, dist in con.execute(
                     "select id, name, race_day, distance_m from goalrace order by race_day desc")]
        return {"km_by_month": km, "shoes": shoes, "races": races}
    except sqlite3.Error:
        return None
    finally:
        con.close()


def overview(session: Session, today: date | None = None, path: Path = RUNLAB_DB) -> dict:
    today = today or date.today()
    rl = runlab_data(path)
    months = []
    y, m = today.year, today.month
    for _ in range(12):
        months.append(f"{y:04d}-{m:02d}")
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    months.reverse()

    since = datetime(int(months[0][:4]), int(months[0][5:]), 1)
    spend: dict[str, int] = defaultdict(int)
    purchases = session.exec(
        select(Txn).where(col(Txn.category).in_(family("러닝")), Txn.kind == "expense", col(Txn.dup_of_id).is_(None))
        .order_by(col(Txn.occurred_at).desc())
    ).all()
    for t in purchases:
        if t.occurred_at >= since:
            spend[t.occurred_at.strftime("%Y-%m")] -= t.amount
    links = {lk.txn_id: lk for lk in session.exec(select(RunLink)).all()}

    km_by = (rl or {}).get("km_by_month", {})
    total_spend = sum(spend.values())
    total_km = sum(km_by.get(mm, 0) for mm in months)

    shoes = []
    for s in (rl or {}).get("shoes", []):
        paid = -sum(t.amount for t in purchases if links.get(t.id) and links[t.id].gear_id == s["id"])
        shoes.append({**s, "price": paid or None,
                      "cost_per_km": round(paid / s["km"]) if paid and s["km"] else None})
    races = []
    for r in (rl or {}).get("races", []):
        fee = -sum(t.amount for t in purchases if links.get(t.id) and links[t.id].race_id == r["id"])
        races.append({**r, "fee": fee or None})

    return {
        "connected": rl is not None,
        "runlab_db": str(path),
        "months": [{"month": mm, "spend": spend.get(mm, 0), "km": km_by.get(mm, 0)} for mm in months],
        "total_spend": total_spend,
        "total_km": round(total_km, 1),
        "cost_per_km": round(total_spend / total_km) if total_km else None,
        "shoes": shoes,
        "races": races,
        "purchases": [
            {"id": t.id, "date": t.occurred_at.date().isoformat(), "merchant": t.merchant, "amount": -t.amount,
             "gear_id": links[t.id].gear_id if t.id in links else None,
             "race_id": links[t.id].race_id if t.id in links else None}
            for t in purchases if t.occurred_at >= datetime.combine(today - timedelta(days=730), datetime.min.time())
        ],
    }


def set_link(session: Session, txn_id: int, gear_id: int | None, race_id: int | None) -> None:
    link = session.get(RunLink, txn_id)
    if gear_id is None and race_id is None:
        if link:
            session.delete(link)
    else:
        link = link or RunLink(txn_id=txn_id)
        link.gear_id, link.race_id = gear_id, race_id
        session.add(link)
    session.commit()
