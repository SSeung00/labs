"""Writing practice with AI feedback: the TOEFL 2026 writing tasks or free writing, typed or handwritten.

Handwritten answers arrive as a PNG of the pen strokes; the model transcribes and corrects them in one
call. Each piece of feedback is evidence for the writing estimate, and its error patterns join the mistake
notebook (and become correction cards) like conversation mistakes do.
"""

from __future__ import annotations

import re
from datetime import datetime

from sqlmodel import Session, select

from app.core import llm, store
from app.core.llm import INT, NUM, STR, arr, obj
from app.learn import levels, lexicon, mistakes, progress
from app.models import Writing

# key → (title, what the task is, minutes it should take, word range)
TASKS: dict[str, tuple[str, str, int, tuple[int, int]]] = {
    "email": ("이메일 쓰기", "TOEFL Write an Email: reply to an everyday or campus situation in a clear, polite "
              "email that covers every point asked.", 7, (80, 180)),
    "discussion": ("학술 토론", "TOEFL Academic Discussion: a professor posts a question and two students reply; "
                   "add your own view with reasons and an example, engaging with the others.", 10, (100, 200)),
    "journal": ("생각 쓰기", "A short opinion or journal entry about the given topic, written naturally.", 10, (80, 250)),
    "free": ("자유 주제", "Anything the learner wants to write.", 10, (30, 400)),
}

PROMPT_SCHEMA = obj({"prompt": STR, "tip_ko": STR})

FEEDBACK_SCHEMA = obj({
    "transcript": STR,
    "level": NUM,
    "band": NUM,
    "scores": obj({"task": INT, "organization": INT, "language": INT}),
    "summary_ko": STR,
    "corrected": STR,
    "upgraded": STR,
    "corrections": arr(obj({"original": STR, "better": STR, "type": {"type": "string", "enum": mistakes.CATEGORIES},
                            "note_ko": STR})),
    "mistakes": arr(mistakes.MISTAKE_ITEM),
    "expressions": arr(obj({"expr": STR, "meaning_ko": STR})),
    "handwriting_ko": STR,
})


def tasks() -> list[dict]:
    return [{"key": k, "title": t, "desc": d, "minutes": m, "min_words": w[0], "max_words": w[1]}
            for k, (t, d, m, w) in TASKS.items()]


def make_prompt(session: Session, task: str) -> dict:
    if task not in TASKS or task == "free":
        raise ValueError("알 수 없는 쓰기 유형이에요.")
    title, desc, _, (lo, hi) = TASKS[task]
    lv = levels.current(session)["levels"].get("writing") or levels.overall_or_default(session)
    p = store.profile(session)
    content = (
        f"Write one writing prompt for a Korean learner of English at about {lexicon.cefr_label(lv)} "
        f"({lv:.1f} on a 1-6 scale). Task type: {desc} Target length: {lo}-{hi} words. Learner interests "
        f"(use one if it fits naturally): {', '.join(p['interests'])}.\n"
        "prompt: the full task text in English exactly as the learner should see it (for an academic "
        "discussion include the professor's question and the two student posts with names). tip_ko: one short "
        "Korean tip for this task type."
    )
    return llm.call_json(session, "coach", PROMPT_SCHEMA, max_tokens=3000, messages=[{"role": "user", "content": content}])


def words_in(text: str) -> int:
    return len(re.findall(r"[A-Za-z]+(?:['’][A-Za-z]+)*", text))


def submit(session: Session, *, task: str, prompt: str, text: str, image: bytes | None, minutes: float) -> Writing:
    if task not in TASKS:
        raise ValueError("알 수 없는 쓰기 유형이에요.")
    text = (text or "").strip()
    if not image and words_in(text) < 15:
        raise ValueError("15단어 이상 써 주세요.")
    title, desc, _, (lo, hi) = TASKS[task]
    lv = levels.current(session)["levels"].get("writing") or levels.overall_or_default(session)
    source = ("The answer is handwritten in the image: transcribe it exactly into transcript (keep the learner's "
              "own errors; mark unreadable words as [?]), then assess the transcript."
              if image else f"transcript: repeat the answer as given.\nAnswer:\n<<<\n{text}\n>>>")
    content = (
        f"Assess this English writing by a Korean learner (current writing estimate {lv:.1f} on a 1-6 scale, "
        "B2=4, C1=5, C2=6).\n"
        f"Task type: {desc} Expected length: {lo}-{hi} words.\nPrompt:\n<<<\n{prompt.strip()[:3000]}\n>>>\n{source}\n\n"
        "Return: level (CEFR on the 1-6 scale for this piece), band (TOEFL writing band 1-6 in half steps), scores "
        "(task, organization, language, each 1-6), summary_ko (2-3 Korean sentences: the main strength and the "
        "one thing to fix first), corrected (the learner's text with only the errors fixed), upgraded (a natural "
        "C1-level version keeping their ideas), corrections (up to 12 important fixes: original span, better "
        "span, type, short Korean note), mistakes (recurring error patterns with a short reusable English label), "
        "expressions (3-5 useful expressions from the upgraded version), handwriting_ko (spelling/legibility "
        "notes if handwritten, else empty)."
    )
    data = llm.call_json(session, "writing", FEEDBACK_SCHEMA, max_tokens=12000, images=[image] if image else None,
                         messages=[{"role": "user", "content": content}])
    body = text or (data.get("transcript") or "").strip()
    row = Writing(created_at=datetime.now(), task=task, prompt=prompt.strip()[:4000], text=body[:8000],
                  handwritten=bool(image), minutes=round(max(0.0, minutes), 1), result=data)
    session.add(row)
    session.flush()
    if minutes > 0:
        progress.log_activity(session, "write", minutes, ref_id=row.id, note=title, commit=False)
    if words_in(body) >= 40:
        levels.record(session, "writing", float(data.get("level") or lv), "writing", note=title, commit=False)
    session.commit()
    mistakes.merge(session, data.get("mistakes") or [], source="writing", source_id=row.id)
    session.refresh(row)
    return row


def view(w: Writing, full: bool = True) -> dict:
    out = {"id": w.id, "created_at": w.created_at.isoformat(timespec="minutes"), "task": w.task,
           "task_title": TASKS.get(w.task, ("",))[0], "prompt": w.prompt, "words": words_in(w.text),
           "handwritten": w.handwritten, "minutes": w.minutes, "level": (w.result or {}).get("level"),
           "band": (w.result or {}).get("band")}
    if full:
        out |= {"text": w.text, "result": w.result}
    return out


def history(session: Session, limit: int = 50) -> list[dict]:
    rows = session.exec(select(Writing).order_by(Writing.id.desc()).limit(limit)).all()
    return [view(w, full=False) for w in rows]
