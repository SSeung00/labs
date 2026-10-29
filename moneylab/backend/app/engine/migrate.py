"""Data upgrades that run once at startup (schema columns are added by db.init_db)."""

import json

from sqlalchemy import func
from sqlmodel import Session, col, delete, select

from app.engine.budget import get_setting, put_setting
from app.engine.categories import PARENT, refine
from app.engine.classify import infer_issuer
from app.engine.pipeline import reprocess
from app.models import Account, BalanceSnapshot, BudgetLine, Category, HoldingSnapshot, Rule, Txn

# Bump when classification logic changes so existing rows are re-derived once.
PIPELINE_VERSION = "5"

# One-level names from before the 대분류 > 소분류 split, for rules and budget lines (which name
# a category without a row to refine against).
OLD_NAMES = {
    "여행": "숙소", "카페/간식": "카페·간식", "술/유흥": "술", "문화/여가": "문화·여가", "의료/건강": "건강·미용",
    "뷰티/미용": "미용", "경조/선물": "경조·선물", "주거/통신": "통신", "세금/공과금": "세금·공과금",
    "금융": "카드·금융 수수료", "자동차": "교통", "생활": "생활용품", "송금": "미분류",
}


def split_categories(session: Session) -> None:
    """Move hand-set categories, rules and budget lines onto the two-level tree."""
    for t in session.exec(select(Txn).where(Txn.category_locked == True)).all():
        new = refine(t.category, t.src_cat, t.src_sub, f"{t.merchant} {t.title or ''} {t.note or ''}")
        if new != t.category:
            t.category = new
            session.add(t)
    for t in session.exec(select(Txn).where(col(Txn.ai_category).is_not(None))).all():
        t.ai_category = t.ai_reason = None
        session.add(t)
    for r in session.exec(select(Rule)).all():
        if r.set_category in OLD_NAMES:
            r.set_category = OLD_NAMES[r.set_category]
            session.add(r)
    for ln in session.exec(select(BudgetLine)).all():
        try:
            cats = json.loads(ln.categories or "[]")
        except json.JSONDecodeError:
            continue
        new = list(dict.fromkeys(OLD_NAMES.get(c, c) if isinstance(c, str) else c for c in cats))
        if new != cats:
            ln.categories = json.dumps(new, ensure_ascii=False)
            session.add(ln)
    session.commit()
    reprocess(session)
    used = set(session.exec(select(Txn.category).distinct()).all())
    for c in session.exec(select(Category)).all():
        if c.name not in PARENT and c.name not in used:
            session.delete(c)
    session.commit()


def run_startup_migrations(session: Session) -> None:
    for a in session.exec(
        select(Account).where(col(Account.kind).in_(("card", "check_card")), col(Account.issuer).is_(None))
    ).all():
        if issuer := infer_issuer(a.name):
            a.issuer = issuer
            session.add(a)
    session.commit()

    # Earlier builds dated every export's balances by the file's period end, but they are all
    # "as of download", so exports downloaded together left identical, wrongly-dated points.
    if get_setting(session, "snapshots.v2") != "1":
        for model in (BalanceSnapshot, HoldingSnapshot):
            latest = session.exec(select(func.max(model.as_of))).one()
            if latest:
                session.exec(delete(model).where(model.as_of < latest))
        put_setting(session, "snapshots.v2", "1")
        session.commit()

    if get_setting(session, "categories.v2") != "1":
        split_categories(session)
        put_setting(session, "categories.v2", "1")
        session.commit()

    if get_setting(session, "pipeline.version") != PIPELINE_VERSION:
        reprocess(session)
        put_setting(session, "pipeline.version", PIPELINE_VERSION)
        session.commit()
