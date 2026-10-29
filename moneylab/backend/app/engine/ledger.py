"""Where the ledger starts.

Exports reach back to whenever Banksalad first saw an account, which can leave a thin, partial
first month or year. Setting a start date removes everything earlier and keeps later imports
from bringing it back.
"""

from datetime import date, datetime, timedelta

from sqlmodel import Session, col, delete, select

from app.engine.budget import get_setting, put_setting
from app.engine.pipeline import reprocess
from app.models import BalanceCheck, RunLink, Txn

KEY = "ledger.start"


def ledger_start(session: Session) -> date | None:
    v = get_setting(session, KEY)
    return date.fromisoformat(v) if v else None


def keep(start: date | None, at: datetime | date) -> bool:
    d = at.date() if isinstance(at, datetime) else at
    return start is None or d >= start


def set_ledger_start(session: Session, start: date | None) -> dict:
    put_setting(session, KEY, start.isoformat() if start else None)
    removed = checks = 0
    if start:
        cut = datetime.combine(start, datetime.min.time())
        ids = list(session.exec(select(Txn.id).where(Txn.occurred_at < cut)).all())
        if ids:
            session.exec(delete(RunLink).where(col(RunLink.txn_id).in_(ids)))
            session.exec(delete(Txn).where(col(Txn.id).in_(ids)))
        removed = len(ids)
        # A balance on the day before the start is still useful: it's the opening balance.
        old = session.exec(select(BalanceCheck).where(BalanceCheck.on_date < start - timedelta(days=1))).all()
        for c in old:
            session.delete(c)
        checks = len(old)
    session.commit()
    if removed:
        reprocess(session)
    return {"start": start, "removed": removed, "checks_removed": checks}
