"""AI helper: monthly report, questions about the data (read-only tools), receipt reading.

Privacy: only aggregates, merchant names and amounts leave the PC. Counterparties that look
like a person's name (transfers, 송금) are masked before anything is sent.
"""

from __future__ import annotations

import base64
import json
import re
from collections import defaultdict
from datetime import date, datetime, timedelta

import anthropic
from sqlalchemy import func
from sqlmodel import Session, col, select

from app.engine import budget as B
from app.engine import recurring as R
from app.engine.claude import FAST_MODEL, MODEL, AIError, client_or_error, create, text_of, usage_of
from app.models import Account, BalanceSnapshot, Category, Goal, Report, Trip, Txn

_PERSON = re.compile(r"^[가-힣*]{2,4}(\((?P<inner>[^)]*)\)?)?$")


def mask(merchant: str, kind: str = "expense", account_kind: str = "card") -> str:
    """Hide people's names: '김*수' → '(개인)', '홍길동(OO펜션' → '(개인) OO펜션'.

    Short Hangul names are only treated as people on transfers and bank rows, so a shop
    called '호남집' on a card statement stays as it is.
    """
    name = merchant.strip()
    m = _PERSON.match(name)
    if not m or not ("*" in name or kind == "transfer" or account_kind == "bank"):
        return merchant
    inner = (m.group("inner") or "").strip()
    return f"(개인) {inner}".strip()


def _day(s: str | None, default: date) -> date:
    try:
        return date.fromisoformat(s) if s else default
    except ValueError:
        return default


def _range(start: date, end: date):
    return (
        Txn.occurred_at >= datetime.combine(start, datetime.min.time()),
        Txn.occurred_at < datetime.combine(end + timedelta(days=1), datetime.min.time()),
    )


def _spending():
    return (Txn.kind == "expense", col(Txn.dup_of_id).is_(None))


# ---------- tools (read-only) ----------

def tool_spending_summary(session: Session, args: dict) -> dict:
    today = date.today()
    start = _day(args.get("start"), today.replace(day=1))
    end = _day(args.get("end"), today)
    group_by = args.get("group_by") or "category"
    cats = {c.name: c.group for c in session.exec(select(Category)).all()}
    accounts = {a.id: (a.label or a.name) for a in session.exec(select(Account)).all()}
    akinds = {a.id: a.kind for a in session.exec(select(Account)).all()}
    conds = [*_spending(), *_range(start, end)]
    if args.get("category"):
        conds.append(Txn.category == args["category"])
    if args.get("merchant_contains"):
        conds.append(col(Txn.merchant).contains(args["merchant_contains"]))
    rows = session.exec(
        select(Txn.category, Txn.merchant, Txn.account_id, Txn.occurred_at, Txn.amount).where(*conds)
    ).all()
    acc: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for cat, merchant, aid, at, amount in rows:
        key = {
            "category": cat, "group": cats.get(cat, "기타"), "merchant": mask(merchant, "expense", akinds.get(aid, "")),
            "month": at.strftime("%Y-%m"), "account": accounts.get(aid, "?"),
        }.get(group_by, cat)
        acc[key][0] -= amount
        acc[key][1] += 1
    items = sorted(({"key": k, "amount": v[0], "count": v[1]} for k, v in acc.items()), key=lambda r: -r["amount"])
    return {
        "start": start.isoformat(), "end": end.isoformat(), "group_by": group_by,
        "total": sum(i["amount"] for i in items), "rows": items[:40],
    }


def tool_find_transactions(session: Session, args: dict) -> dict:
    today = date.today()
    start = _day(args.get("start"), today - timedelta(days=90))
    end = _day(args.get("end"), today)
    conds = [*_range(start, end), col(Txn.dup_of_id).is_(None)]
    if args.get("kind"):
        conds.append(Txn.kind == args["kind"])
    if args.get("category"):
        conds.append(Txn.category == args["category"])
    if args.get("merchant_contains"):
        conds.append(col(Txn.merchant).contains(args["merchant_contains"]))
    if args.get("min_amount"):
        conds.append(func.abs(Txn.amount) >= int(args["min_amount"]))
    limit = max(1, min(int(args.get("limit") or 20), 50))
    order = func.abs(Txn.amount).desc() if args.get("sort") == "amount" else col(Txn.occurred_at).desc()
    accounts = {a.id: (a.label or a.name) for a in session.exec(select(Account)).all()}
    akinds = {a.id: a.kind for a in session.exec(select(Account)).all()}
    trips = {t.id: t.name for t in session.exec(select(Trip)).all()}
    rows = session.exec(select(Txn).where(*conds).order_by(order).limit(limit)).all()
    return {"transactions": [
        {
            "date": t.occurred_at.strftime("%Y-%m-%d"), "merchant": mask(t.merchant, t.kind, akinds.get(t.account_id, "")),
            "amount": t.amount,
            "kind": t.kind, "category": t.category, "account": accounts.get(t.account_id),
            "trip": trips.get(t.trip_id), "note": t.note,
        }
        for t in rows
    ]}


def tool_budget_status(session: Session, args: dict) -> dict:
    month = args.get("month") or B.ym(date.today())
    v = B.month_view(session, month)
    return {
        "month": month, "configured": bool(v["lines"]), "pace": round(v["pace"], 2),
        "income": v["income"], "totals": v["totals"],
        "lines": [{k: ln.get(k) for k in ("name", "kind", "planned", "actual", "balance")} for ln in v["lines"]],
        "unbudgeted": v["unbudgeted"][:10],
    }


def tool_cash_plan(session: Session, args: dict) -> dict:
    f = B.forecast(session, 12)
    return {
        "monthly_balance": f["monthly_balance"], "committed": f["committed"], "start_cash": f["start_cash"],
        "emergency_target": f["emergency_target"], "warnings": f["warnings"][:5],
        "months": [{k: m[k] for k in ("month", "cash", "reserved", "free", "event_out")} for m in f["months"]],
    }


def tool_trips(session: Session, args: dict) -> dict:
    out = []
    for t in session.exec(select(Trip).order_by(col(Trip.start_date).desc())).all():
        spent = -session.exec(
            select(func.coalesce(func.sum(Txn.amount), 0)).where(Txn.trip_id == t.id, *_spending())
        ).one()
        out.append({"name": t.name, "start": t.start_date.isoformat(), "end": t.end_date.isoformat(),
                    "budget": t.budget, "spent": spent})
    return {"trips": out}


def tool_balances(session: Session, args: dict) -> dict:
    as_of = session.exec(select(func.max(BalanceSnapshot.as_of))).one()
    rows = session.exec(select(BalanceSnapshot).where(BalanceSnapshot.as_of == as_of)).all() if as_of else []
    goals = session.exec(select(Goal)).all()
    return {
        "as_of": as_of.isoformat() if as_of else None,
        "accounts": [{"group": r.group, "name": r.name, "amount": r.amount, "side": r.side} for r in rows if r.amount],
        "goals": [{"name": g.name, "kind": g.kind, "target": g.target_amount, "target_date": str(g.target_date) if g.target_date else None,
                   "monthly": g.monthly_amount} for g in goals],
    }


def tool_recurring(session: Session, args: dict) -> dict:
    items = R.detect(session)
    return {"monthly_total": sum(i["monthly_cost"] for i in items if i["active"]),
            "items": [{k: i[k] for k in ("merchant", "cadence", "amount", "next_date", "active", "monthly_cost", "category")} for i in items[:30]]}


def _nullable(t: str) -> dict:
    return {"type": [t, "null"]}


TOOLS = [
    {
        "name": "spending_summary",
        "description": "지출(카드대금·이체·중복 제외) 합계를 기간별로 묶어서 돌려줘요. 날짜는 YYYY-MM-DD, 기본은 이번 달 1일~오늘.",
        "input_schema": {
            "type": "object",
            "properties": {
                "start": _nullable("string"), "end": _nullable("string"),
                "group_by": {"type": "string", "enum": ["category", "group", "merchant", "month", "account"]},
                "category": _nullable("string"), "merchant_contains": _nullable("string"),
            },
            "required": ["start", "end", "group_by", "category", "merchant_contains"],
            "additionalProperties": False,
        },
    },
    {
        "name": "find_transactions",
        "description": "개별 거래를 찾아요. kind: expense/income/transfer/card_payment/savings/invest. sort: date 또는 amount(큰 순).",
        "input_schema": {
            "type": "object",
            "properties": {
                "start": _nullable("string"), "end": _nullable("string"), "kind": _nullable("string"),
                "category": _nullable("string"), "merchant_contains": _nullable("string"),
                "min_amount": _nullable("integer"), "limit": _nullable("integer"),
                "sort": {"type": "string", "enum": ["date", "amount"]},
            },
            "required": ["start", "end", "kind", "category", "merchant_contains", "min_amount", "limit", "sort"],
            "additionalProperties": False,
        },
    },
    {
        "name": "budget_status",
        "description": "그 달의 예산 항목별 계획 대비 실제, 봉투 잔액, 예산 밖 지출. month는 YYYY-MM.",
        "input_schema": {"type": "object", "properties": {"month": _nullable("string")}, "required": ["month"], "additionalProperties": False},
    },
    {
        "name": "cash_plan",
        "description": "앞으로 12개월 자금 계획: 월말 예상 잔액, 봉투 적립금, 자유 자금, 경고.",
        "input_schema": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
    },
    {
        "name": "trips",
        "description": "등록된 여행 목록과 여행별 지출·예산.",
        "input_schema": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
    },
    {
        "name": "balances",
        "description": "최근 뱅크샐러드 기준 계좌별 잔액과 목표(적금·기금).",
        "input_schema": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
    },
    {
        "name": "recurring",
        "description": "정기결제·구독으로 보이는 결제 목록과 월 환산 금액.",
        "input_schema": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
    },
]
for _t in TOOLS:
    _t["strict"] = True

HANDLERS = {
    "spending_summary": tool_spending_summary,
    "find_transactions": tool_find_transactions,
    "budget_status": tool_budget_status,
    "cash_plan": tool_cash_plan,
    "trips": tool_trips,
    "balances": tool_balances,
    "recurring": tool_recurring,
}


def run_tool(session: Session, name: str, args: dict) -> tuple[str, bool]:
    handler = HANDLERS.get(name)
    if not handler:
        return f"알 수 없는 도구: {name}", True
    try:
        return json.dumps(handler(session, args or {}), ensure_ascii=False, default=str), False
    except Exception as e:  # report to the model instead of failing the whole answer
        return f"도구 실행 오류: {e}", True


def _context_line(session: Session) -> str:
    first, last = session.exec(select(func.min(Txn.occurred_at), func.max(Txn.occurred_at))).one()
    cats = ", ".join(c.name for c in session.exec(select(Category).order_by(Category.sort)).all())
    return (
        f"오늘은 {date.today().isoformat()}. 데이터 범위: {first:%Y-%m-%d} ~ {last:%Y-%m-%d}. "
        f"카테고리: {cats}." if first else "아직 가져온 데이터가 없어요."
    )


ASK_SYSTEM = """당신은 한 사람의 개인 가계부(MoneyLab) 데이터에 대해 질문에 답하는 도우미입니다.
도구로 데이터를 조회한 뒤, 숫자를 근거로 한국어로 짧고 정확하게 답하세요.

- 금액은 원 단위로 쉼표를 넣어 쓰고, 기간을 분명히 밝히세요.
- 지출 합계는 카드대금·이체·중복이 빠진 '실제 지출' 기준입니다. kind가 transfer인 돈은 지출이 아닙니다.
- 데이터로 알 수 없는 것은 추측하지 말고 모른다고 말하세요. 뱅크샐러드 기록은 2024년 12월 말부터 있습니다.
- 특정 금융상품·종목을 추천하지 마세요. 예산·지출에 대한 관찰과 제안은 괜찮습니다.
- 답은 보통 3~8줄. 필요하면 짧은 목록이나 표를 써도 됩니다."""

MAX_STEPS = 8


def ask(session: Session, question: str, history: list[dict] | None = None,
        client: anthropic.Anthropic | None = None) -> dict:
    client = client_or_error(client)
    messages: list = []
    for h in (history or [])[-3:]:
        if h.get("q") and h.get("a"):
            messages += [{"role": "user", "content": str(h["q"])[:2000]},
                         {"role": "assistant", "content": str(h["a"])[:4000]}]
    messages.append({"role": "user", "content": question[:2000]})
    system = ASK_SYSTEM + "\n\n" + _context_line(session)
    calls: list[dict] = []
    tokens_in = tokens_out = 0
    for _ in range(MAX_STEPS):
        response = create(
            client, model=MODEL, max_tokens=16000, system=system, tools=TOOLS,
            output_config={"effort": "medium"}, messages=messages,
        )
        i, o = usage_of(response)
        tokens_in, tokens_out = tokens_in + i, tokens_out + o
        uses = [b for b in response.content if b.type == "tool_use"]
        if response.stop_reason != "tool_use" or not uses:
            return {"answer": text_of(response) or "답을 만들지 못했어요.", "tool_calls": calls,
                    "usage": {"input": tokens_in, "output": tokens_out}}
        # Append the whole turn unchanged (thinking blocks included), then every result at once.
        messages.append({"role": "assistant", "content": response.content})
        results = []
        for u in uses:
            out, is_err = run_tool(session, u.name, u.input if isinstance(u.input, dict) else {})
            calls.append({"name": u.name, "input": u.input})
            results.append({"type": "tool_result", "tool_use_id": u.id, "content": out, "is_error": is_err})
        messages.append({"role": "user", "content": results})
    raise AIError("질문이 너무 복잡해서 끝까지 답하지 못했어요. 조금 더 구체적으로 물어봐 주세요.")


# ---------- monthly report ----------

REPORT_SYSTEM = """당신은 개인 가계부의 월간 리포트를 쓰는 도우미입니다. 한 사람의 한 달 데이터(JSON)를 받아
한국어 Markdown 리포트를 씁니다. 이 사람은 평소 지출은 적게 하고 돈을 모아 1년에 1~2번 큰 여행을 가며,
러닝(대회·용품)과 카메라에 가끔 돈을 씁니다. 투자는 공부하며 시작하려는 단계입니다.

형식:
## 한 줄 요약
## 이번 달 숫자
## 잘한 점
## 살펴볼 점
## 다음 달 제안

- 각 섹션 2~4개 bullet. 반드시 데이터의 숫자를 인용하세요.
- 지난 3개월 평균과 비교해 눈에 띄게 달라진 카테고리, 큰 결제, 예산 초과, 봉투 잔액, 정기결제를 짚으세요.
- 제안은 예산 금액 조정처럼 구체적으로. 특정 금융상품·종목 추천은 하지 마세요.
- 생활 방식을 평가하지 말고 사실과 선택지를 보여 주세요. 데이터가 부족하면 그렇다고 쓰세요.
- 500단어 이내."""


def month_context(session: Session, month: str) -> dict:
    start, end = B.month_start(month), B.month_end(month)
    prev = [B.add_months(month, -i) for i in (1, 2, 3)]
    cat_rows = session.exec(
        select(Txn.category, func.sum(Txn.amount)).where(*_spending(), Txn.occurred_at >= start, Txn.occurred_at < end)
        .group_by(Txn.category)
    ).all()
    prev_rows = session.exec(
        select(Txn.category, func.sum(Txn.amount)).where(
            *_spending(), Txn.occurred_at >= B.month_start(prev[-1]), Txn.occurred_at < start
        ).group_by(Txn.category)
    ).all()
    prev_avg = {c: round(-s / 3) for c, s in prev_rows}
    by_cat = sorted(({"category": c, "amount": -s, "avg_prev3": prev_avg.get(c, 0)} for c, s in cat_rows),
                    key=lambda r: -r["amount"])
    akinds = {a.id: a.kind for a in session.exec(select(Account)).all()}
    big = session.exec(
        select(Txn).where(*_spending(), Txn.occurred_at >= start, Txn.occurred_at < end, Txn.amount < 0)
        .order_by(Txn.amount).limit(8)
    ).all()
    merchants = tool_spending_summary(session, {"start": start.date().isoformat(),
                                                "end": (end - timedelta(days=1)).date().isoformat(),
                                                "group_by": "merchant"})["rows"][:10]
    income = session.exec(select(func.coalesce(func.sum(Txn.amount), 0)).where(
        Txn.kind == "income", Txn.occurred_at >= start, Txn.occurred_at < end)).one()
    rec = R.detect(session)
    return {
        "month": month,
        "spending_total": sum(r["amount"] for r in by_cat),
        "spending_prev3_avg": round(sum(prev_avg.values())),
        "income": income,
        "by_category": by_cat[:15],
        "top_merchants": merchants,
        "largest_payments": [{"date": t.occurred_at.strftime("%m-%d"), "merchant": mask(t.merchant, t.kind, akinds.get(t.account_id, "")),
                              "amount": -t.amount, "category": t.category} for t in big],
        "budget": tool_budget_status(session, {"month": month}),
        "recurring_monthly_total": sum(i["monthly_cost"] for i in rec if i["active"]),
        "recurring_top": [{"merchant": i["merchant"], "monthly_cost": i["monthly_cost"]} for i in rec[:6] if i["active"]],
        "trips": [t for t in tool_trips(session, {})["trips"] if t["start"][:7] <= month <= t["end"][:7]
                  or t["start"][:7] == B.add_months(month, 1)],
        "cash_plan": {k: v for k, v in tool_cash_plan(session, {}).items() if k in ("monthly_balance", "committed", "warnings")},
    }


def make_report(session: Session, month: str, client: anthropic.Anthropic | None = None) -> Report:
    client = client_or_error(client)
    ctx = month_context(session, month)
    response = create(
        client, model=MODEL, max_tokens=16000, system=REPORT_SYSTEM, output_config={"effort": "medium"},
        messages=[{"role": "user", "content": f"{month} 데이터입니다:\n```json\n"
                   + json.dumps(ctx, ensure_ascii=False, default=str) + "\n```"}],
    )
    text = text_of(response)
    if not text:
        raise AIError("빈 응답을 받았어요.")
    i, o = usage_of(response)
    report = Report(month=month, created_at=datetime.now(), model=getattr(response, "model", MODEL),
                    markdown=text, input_tokens=i, output_tokens=o)
    session.add(report)
    session.commit()
    session.refresh(report)
    return report


# ---------- receipts & screenshots ----------

RECEIPT_SYSTEM = """영수증 사진이나 결제 내역 스크린샷(카드 앱, 카카오페이, 해외 결제 등)에서 결제 건을 뽑아내세요.
- 한 장에 여러 건이 있으면 모두 뽑으세요. 합계·잔액·포인트 줄은 결제가 아닙니다.
- amount는 결제 금액(양수). 환불·취소면 refund를 true로.
- 외화 결제면 currency에 통화 코드(JPY, USD, AUD …)와 그 통화 금액을, 원화 청구액이 보이면 krw_amount에 적으세요.
- 날짜·시간이 안 보이면 null. category는 목록에서 가장 알맞은 것, 모르면 null."""


def _receipt_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "date": _nullable("string"), "time": _nullable("string"),
                        "merchant": {"type": "string"},
                        "amount": {"type": "number"},
                        "currency": {"type": "string"},
                        "krw_amount": _nullable("integer"),
                        "refund": {"type": "boolean"},
                        "category": _nullable("string"),
                        "memo": _nullable("string"),
                    },
                    "required": ["date", "time", "merchant", "amount", "currency", "krw_amount", "refund", "category", "memo"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["items"],
        "additionalProperties": False,
    }


IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


def read_receipts(session: Session, images: list[tuple[bytes, str]],
                  client: anthropic.Anthropic | None = None) -> list[dict]:
    client = client_or_error(client)
    cats = [c.name for c in session.exec(select(Category).order_by(Category.sort)).all() if c.group != "수입"]
    content: list = []
    for data, media in images:
        content.append({"type": "image", "source": {
            "type": "base64", "media_type": media, "data": base64.standard_b64encode(data).decode()}})
    content.append({"type": "text", "text": f"오늘은 {date.today().isoformat()}이에요. 카테고리 목록: "
                    + ", ".join(cats) + ". 결제 건을 뽑아 주세요."})
    response = create(
        client, model=FAST_MODEL, max_tokens=16000, system=RECEIPT_SYSTEM,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": _receipt_schema()}},
        messages=[{"role": "user", "content": content}],
    )
    try:
        items = json.loads(text_of(response))["items"]
    except (json.JSONDecodeError, KeyError, TypeError) as e:
        raise AIError("사진에서 결제 내역을 읽지 못했어요.") from e
    out = []
    for it in items:
        cur = (it.get("currency") or "KRW").upper()
        amount = float(it.get("amount") or 0)
        krw = it.get("krw_amount") or (round(amount) if cur == "KRW" else None)
        out.append({
            "date": it.get("date"), "time": it.get("time"), "merchant": (it.get("merchant") or "").strip()[:80],
            "currency": cur, "fx_amount": amount if cur != "KRW" else None, "krw_amount": krw,
            "refund": bool(it.get("refund")), "category": it.get("category") if it.get("category") in cats else None,
            "memo": it.get("memo"),
        })
    return out
