import json
from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import select

from app.db import SessionDep
from app.engine import budget as B
from app.models import BudgetLine, PlanEvent

router = APIRouter(tags=["budget"])

MONTH = r"^\d{4}-\d{2}$"
LINE_KINDS = "^(spend|fund|save|invest)$"


@router.get("/budget")
def month_budget(session: SessionDep, month: str | None = None) -> dict:
    month = month or B.ym(date.today())
    view = B.month_view(session, month)
    view["settings"] = B.plan_settings(session)
    view["configured"] = bool(B.active_lines(session))
    return view


@router.get("/budget/history")
def budget_history(session: SessionDep, months: int = 6) -> list[dict]:
    current = B.ym(date.today())
    out = []
    for i in range(months - 1, -1, -1):
        v = B.month_view(session, B.add_months(current, -i))
        out.append({
            "month": v["month"],
            "income": v["income"]["actual"],
            "lines": [{"id": ln["id"], "planned": ln["planned"], "actual": ln["actual"]} for ln in v["lines"]],
            "unbudgeted": sum(u["amount"] for u in v["unbudgeted"]),
        })
    return out


class LineIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    kind: str = Field(pattern=LINE_KINDS)
    categories: list[str | int] = []
    include_trips: bool = False
    monthly_amount: int = Field(ge=0)
    start_month: str | None = Field(default=None, pattern=MONTH)
    opening_balance: int = 0
    color: str | None = None
    sort: int | None = None
    active: bool = True


def _line_out(ln: BudgetLine) -> dict:
    return {**ln.model_dump(), "categories": B.line_categories(ln)}


@router.get("/budget/lines")
def list_lines(session: SessionDep) -> list[dict]:
    lines = session.exec(select(BudgetLine).order_by(BudgetLine.sort, BudgetLine.id)).all()
    return [_line_out(ln) for ln in lines]


def _apply(ln: BudgetLine, body: LineIn) -> None:
    data = body.model_dump()
    data["categories"] = json.dumps(body.categories, ensure_ascii=False)
    if body.kind == "fund" and not body.start_month:
        data["start_month"] = B.ym(date.today())
    if data.get("sort") is None:
        data.pop("sort")
    for k, v in data.items():
        setattr(ln, k, v)


@router.post("/budget/lines")
def create_line(body: LineIn, session: SessionDep) -> dict:
    ln = BudgetLine(name=body.name)
    _apply(ln, body)
    if body.sort is None:
        ln.sort = len(session.exec(select(BudgetLine)).all())
    session.add(ln)
    session.commit()
    session.refresh(ln)
    return _line_out(ln)


@router.put("/budget/lines/{line_id}")
def update_line(line_id: int, body: LineIn, session: SessionDep) -> dict:
    ln = session.get(BudgetLine, line_id)
    if not ln:
        raise HTTPException(404, "예산 항목을 찾을 수 없어요.")
    _apply(ln, body)
    session.add(ln)
    session.commit()
    return _line_out(ln)


@router.delete("/budget/lines/{line_id}")
def delete_line(line_id: int, session: SessionDep) -> dict:
    ln = session.get(BudgetLine, line_id)
    if not ln:
        raise HTTPException(404, "예산 항목을 찾을 수 없어요.")
    for e in session.exec(select(PlanEvent).where(PlanEvent.line_id == line_id)).all():
        e.line_id = None
        session.add(e)
    session.delete(ln)
    session.commit()
    return {"ok": True}


class OrderIn(BaseModel):
    ids: list[int]


@router.put("/budget/order")
def reorder(body: OrderIn, session: SessionDep) -> dict:
    for i, lid in enumerate(body.ids):
        ln = session.get(BudgetLine, lid)
        if ln:
            ln.sort = i
            session.add(ln)
    session.commit()
    return {"ok": True}


class SettingsIn(BaseModel):
    income: int = Field(ge=0)
    emergency_months: float = Field(ge=0, le=24)


@router.put("/budget/settings")
def put_settings(body: SettingsIn, session: SessionDep) -> dict:
    B.put_setting(session, "plan.income", str(body.income))
    B.put_setting(session, "plan.emergency_months", str(body.emergency_months))
    session.commit()
    return B.plan_settings(session)


@router.get("/budget/draft")
def draft(session: SessionDep) -> dict:
    return B.suggest_plan(session)


class DraftIn(BaseModel):
    income: int = Field(ge=0)
    lines: list[dict]


@router.post("/budget/draft/apply")
def apply_draft(body: DraftIn, session: SessionDep) -> dict:
    for ln in body.lines:
        if ln.get("kind") not in ("spend", "fund", "save", "invest") or not ln.get("name"):
            raise HTTPException(400, "초안 형식이 올바르지 않아요.")
    B.apply_plan(session, body.model_dump(), B.ym(date.today()))
    return {"ok": True}


# ---------- 12-month plan ----------

@router.get("/plan/forecast")
def plan_forecast(session: SessionDep, months: int = 12) -> dict:
    return B.forecast(session, min(max(months, 3), 36))


class EventIn(BaseModel):
    month: str = Field(pattern=MONTH)
    name: str = Field(min_length=1, max_length=60)
    amount: int
    line_id: int | None = None
    trip_id: int | None = None
    note: str | None = None


@router.get("/plan/events")
def list_events(session: SessionDep) -> list[PlanEvent]:
    return list(session.exec(select(PlanEvent).order_by(PlanEvent.month, PlanEvent.id)).all())


@router.post("/plan/events")
def create_event(body: EventIn, session: SessionDep) -> PlanEvent:
    e = PlanEvent(**body.model_dump())
    session.add(e)
    session.commit()
    session.refresh(e)
    return e


@router.put("/plan/events/{event_id}")
def update_event(event_id: int, body: EventIn, session: SessionDep) -> PlanEvent:
    e = session.get(PlanEvent, event_id)
    if not e:
        raise HTTPException(404, "계획을 찾을 수 없어요.")
    for k, v in body.model_dump().items():
        setattr(e, k, v)
    session.add(e)
    session.commit()
    session.refresh(e)
    return e


@router.delete("/plan/events/{event_id}")
def delete_event(event_id: int, session: SessionDep) -> dict:
    e = session.get(PlanEvent, event_id)
    if not e:
        raise HTTPException(404, "계획을 찾을 수 없어요.")
    session.delete(e)
    session.commit()
    return {"ok": True}
