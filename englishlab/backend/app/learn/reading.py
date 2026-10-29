"""Reading material at the learner's level: from a URL, pasted text, or a topic of interest.

Modes:
- adapt: rewritten one step above the learner's reading level (i+1), aiming at ~96–98% known words,
  keeping 6–10 useful words/phrases just above level as learning targets.
- gloss: the original text kept as is, with notes on the hard words (for texts already near level).
- topic: a new article written at that level about something the learner cares about.
"""

from __future__ import annotations

import re
from datetime import datetime

import httpx
from sqlmodel import Session

from app.core import llm, store
from app.core.llm import INT, NUM, STR, arr, obj
from app.learn import levels, lexicon
from app.models import Reading

MAX_SOURCE_WORDS = 12000


class ReadingError(Exception):
    pass


def fetch_url(url: str) -> tuple[str, str]:
    """(title, main text) of a web article."""
    import trafilatura

    if not re.match(r"^https?://", url):
        raise ReadingError("http(s) 주소를 넣어 주세요.")
    try:
        r = httpx.get(url, follow_redirects=True, timeout=20,
                      headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) EnglishLab/0.1"})
        r.raise_for_status()
    except httpx.HTTPError as e:
        raise ReadingError(f"페이지를 가져오지 못했어요: {e}") from e
    text = trafilatura.extract(r.text, include_comments=False, include_tables=False, favor_precision=True) or ""
    meta = trafilatura.extract_metadata(r.text)
    title = (meta.title if meta and meta.title else "") or url
    if len(text.split()) < 60:
        raise ReadingError("본문을 찾지 못했어요. 글을 복사해서 '직접 붙여넣기'로 넣어 주세요.")
    return title, text


SCHEMA = obj({
    "title": STR,
    "body": STR,
    "level": NUM,
    "targets": arr(obj({"term": STR, "meaning_ko": STR, "definition_en": STR})),
    "expressions": arr(obj({"expr": STR, "meaning_ko": STR, "note_ko": STR})),
    "questions": arr(obj({"q": STR, "choices": arr(STR), "answer": INT, "explanation_ko": STR})),
    "summary_ko": STR,
    "talk_prompt": STR,
})


def _guidance(level: float, vocab: int) -> str:
    target = min(6.0, level + 0.5)
    return (f"The learner's reading level is {lexicon.cefr_label(level)} ({level:.1f} on a 1-6 scale where B2=4, "
            f"C1=5, C2=6) and they know roughly {vocab} English lemmas (most frequent first). Target level for "
            f"this text: {lexicon.cefr_label(target)} ({target:.1f}).")


COMMON_RULES = """
Return:
- title: a clear English title.
- body: the text to read, plain text, paragraphs separated by a blank line (no markdown, no headings).
- level: your estimate of the body's CEFR level on the 1-6 scale.
- targets: 6-10 words or multi-word chunks (collocations, phrasal verbs, idioms) in the body that are
  just above the learner's level and most worth learning; term exactly as it appears in the body.
- expressions: 3-5 natural expressions from the body useful in conversation, with Korean notes.
- questions: 4 multiple-choice comprehension questions (gist, detail, inference, vocabulary in
  context), 4 choices each, answer = index of the correct choice, explanation in Korean.
- summary_ko: 2-3 sentence Korean summary.
- talk_prompt: one open English question to discuss the text with an AI tutor afterwards.
"""


def create(session: Session, *, source_kind: str, url: str | None = None, text: str | None = None,
           topic: str | None = None, mode: str = "auto", length: str = "medium") -> Reading:
    lv = levels.current(session)["levels"].get("reading") or levels.overall_or_default(session)
    vocab = lexicon.known_count(session)
    p = store.profile(session)
    title = ""
    original: str | None = None
    if source_kind == "url":
        title, original = fetch_url(url or "")
    elif source_kind == "text":
        original = (text or "").strip()
        if len(original.split()) < 30:
            raise ReadingError("30단어 이상의 영어 글을 넣어 주세요.")
    elif source_kind == "topic":
        if not (topic or "").strip():
            raise ReadingError("주제를 입력해 주세요.")
    else:
        raise ReadingError("알 수 없는 자료 종류예요.")

    words = {"short": "250-350", "medium": "450-650", "long": "800-1000"}.get(length, "450-650")
    src_cov = None
    if original is not None:
        n = len(original.split())
        if n > MAX_SOURCE_WORDS:
            raise ReadingError(f"글이 너무 길어요 ({n:,}단어). {MAX_SOURCE_WORDS:,}단어 이하로 나눠서 넣어 주세요.")
        src_cov = lexicon.coverage(session, original)["coverage"]
        if mode == "auto":
            mode = "gloss" if src_cov >= 0.975 else "adapt"
        if mode == "adapt":
            task = (f"Rewrite this text for the learner at the target level, about {words} words. Keep the facts, "
                    "argument and tone; simplify only what is far above level; keep the target chunks natural. "
                    "If the source is long, condense it to the most interesting parts (say so in summary_ko).")
        else:
            mode = "gloss"
            task = ("Keep the text exactly as it is (body = the original, cleaned of navigation/boilerplate lines "
                    "only). Choose targets/expressions from it.")
        content = f"{_guidance(lv, vocab)}\n\n{task}\n{COMMON_RULES}\nSource text:\n<<<\n{original}\n>>>"
    else:
        mode = "adapt"
        content = (f"{_guidance(lv, vocab)}\nLearner interests: {', '.join(p['interests'])}.\n\nWrite an engaging, "
                   f"accurate original article of about {words} words on: {topic}. Use a natural magazine or "
                   f"good-blog style with real-world detail (avoid made-up statistics).\n{COMMON_RULES}")

    data = llm.call_json(session, "reading", SCHEMA, max_tokens=16000, messages=[{"role": "user", "content": content}])
    body = data["body"].strip()
    cov = lexicon.coverage(session, body)
    row = Reading(
        created_at=datetime.now(), title=data["title"] or title or (topic or "읽기"), source_kind=source_kind,
        source_url=url if source_kind == "url" else None, original=original, mode=mode,
        target_level=float(data.get("level") or min(6.0, lv + 0.5)), body=body,
        data={k: data[k] for k in ("targets", "expressions", "questions", "summary_ko", "talk_prompt")}
        | {"source_coverage": src_cov},
        word_count=cov["tokens"], coverage=cov["coverage"],
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def view(session: Session, r: Reading, full: bool = True) -> dict:
    out = {
        "id": r.id, "title": r.title, "created_at": r.created_at.isoformat(timespec="minutes"),
        "source_kind": r.source_kind, "source_url": r.source_url, "mode": r.mode,
        "level": r.target_level, "level_label": lexicon.cefr_label(r.target_level),
        "word_count": r.word_count, "coverage": r.coverage, "finished_at": r.finished_at.isoformat(timespec="minutes") if r.finished_at else None,
        "minutes": round(r.minutes, 1), "quiz_score": r.quiz_score,
        "summary_ko": (r.data or {}).get("summary_ko"),
    }
    if full:
        cov = lexicon.coverage(session, r.body)
        out |= {"body": r.body, "original": r.original, "data": r.data, "unknown": cov["unknown"][:300],
                "unknown_forms": cov["forms"], "coverage_now": cov["coverage"]}
    return out


QUICK_SCHEMA = obj({"items": arr(obj({"w": STR, "ko": STR}))})


def quick_gloss(session: Session, r: Reading) -> dict[str, str]:
    """Short Korean meanings for the likely-unknown words of a text, in this text's sense (one cheap call,
    cached on the reading), so tapping one of them shows its meaning at once and the reader can show
    meanings above the words."""
    cached = (r.data or {}).get("quick_gloss")
    if cached is not None:
        return cached
    cov = lexicon.coverage(session, r.body)
    lemmas = cov["unknown"][:80]
    if not lemmas:
        r.data = {**(r.data or {}), "quick_gloss": {}}
        session.add(r)
        session.commit()
        return {}
    forms: dict[str, list[str]] = {}
    for form, lem in cov["forms"].items():
        forms.setdefault(lem, []).append(form)
    listing = "\n".join(f"{lem} ({', '.join(forms.get(lem, [])[:3])})" for lem in lemmas)
    content = (f"Text:\n<<<\n{r.body[:9000]}\n>>>\n\nFor each word below (dictionary form, then the forms used in the "
               "text), give the Korean meaning that fits THIS text, as short as possible (1-3 words, max 12 "
               "characters). w = the dictionary form exactly as listed.\n" + listing)
    data = llm.call_json(session, "quickgloss", QUICK_SCHEMA, max_tokens=6000,
                         messages=[{"role": "user", "content": content}])
    out = {it["w"].strip().lower(): it["ko"].strip()[:24] for it in data.get("items") or [] if it.get("w") and it.get("ko")}
    r.data = {**(r.data or {}), "quick_gloss": out}
    session.add(r)
    session.commit()
    return out


def finish(session: Session, r: Reading, *, minutes: float, listen_minutes: float, answers: list[int] | None,
           known: list[str], unknown: list[str], quiz_mode: str = "read") -> dict:
    from app.learn import progress

    if known:
        lexicon.mark(session, known, "known")
    if unknown:
        lexicon.mark(session, unknown, "unknown")
    score = None
    qs = (r.data or {}).get("questions") or []
    if answers is not None and qs:
        score = sum(1 for q, a in zip(qs, answers, strict=False) if q["answer"] == a) / len(qs)
        r.quiz_score = round(score, 2)
    r.minutes += minutes + listen_minutes
    r.finished_at = r.finished_at or datetime.now()
    session.add(r)
    if minutes > 0:
        progress.log_activity(session, "read", minutes, ref_id=r.id, commit=False)
    if listen_minutes > 0:
        progress.log_activity(session, "listen", listen_minutes, ref_id=r.id, commit=False)
    # A well-understood text at a given level is (weak) evidence of reading at that level — or of listening,
    # when the quiz was answered after only hearing the text (listening-first mode, text never shown).
    if score is not None and r.target_level and len(qs) >= 3:
        skill = "listening" if quiz_mode == "listen" else "reading"
        levels.record(session, skill, r.target_level - 0.6 + 0.6 * score, skill, note=r.title[:80], commit=False)
    session.commit()
    return {"quiz_score": score, "known_count": lexicon.known_count(session)}
