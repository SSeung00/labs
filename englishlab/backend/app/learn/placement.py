"""Placement test: vocabulary yes/no test, reading, dictation (listening), speaking and writing.

Objective parts are scored locally; Opus then judges speaking/writing and combines all evidence into
per-skill levels (1.0–6.0) with feedback. Test material is generated in the background while the
learner fills in their profile.
"""

from __future__ import annotations

import logging
import random
import re
import threading
from datetime import datetime

from sqlmodel import Session

from app.core import llm, store
from app.core.llm import NUM, STR, arr, obj
from app.db import engine
from app.learn import levels, lexicon, mistakes, progress
from app.models import Placement

log = logging.getLogger("englishlab.placement")

# Frequency bands (lemma ranks) for the yes/no vocabulary test, and words sampled per band.
BANDS = [(1, 1000), (1000, 2000), (2000, 3000), (3000, 4500), (4500, 6000), (6000, 8000),
         (8000, 10000), (10000, 13000), (13000, 16000)]
PER_BAND = 6
SAMPLE_PER_BAND = 10  # sampled; the AI drops names/abbreviations, then PER_BAND are kept

LEVEL_NUM = {"A1": 1.0, "A2": 2.0, "B1": 3.0, "B2": 4.0, "C1": 5.0, "C2": 6.0}


# ---------- material ----------

MATERIAL_SCHEMA = obj({
    "not_real_words": arr(STR),
    "pseudowords": arr(STR),
    "reading": arr(obj({
        "level": {"type": "string", "enum": ["B1", "B2", "C1"]},
        "title": STR, "text": STR,
        "questions": arr(obj({"q": STR, "choices": arr(STR), "answer": {"type": "integer"}})),
    })),
    "dictation": arr(obj({"level": {"type": "string", "enum": list(LEVEL_NUM)}, "text": STR})),
    "speaking": arr(obj({"prompt": STR, "seconds": {"type": "integer"}})),
    "writing": obj({"prompt": STR, "min_words": {"type": "integer"}, "max_words": {"type": "integer"}}),
})


def _sample_words(seed: int) -> list[dict]:
    rnd = random.Random(seed)
    out = []
    for lo, hi in BANDS:
        pool = [w for w in lexicon.lemmas_in_band(lo, hi) if len(w) >= 3]
        for w in rnd.sample(pool, min(SAMPLE_PER_BAND, len(pool))):
            out.append({"word": w, "band": [lo, hi]})
    return out


def start(session: Session) -> Placement:
    seed = random.randrange(10**9)
    pl = Placement(created_at=datetime.now(), material={"status": "generating", "candidates": _sample_words(seed)},
                   answers={})
    session.add(pl)
    session.commit()
    session.refresh(pl)
    threading.Thread(target=_generate, args=(pl.id,), daemon=True, name=f"placement-{pl.id}").start()
    return pl


def retry(session: Session, pl: Placement) -> Placement:
    """Make the test material again after a failed generation (same vocabulary sample)."""
    if pl.material.get("status") != "error":
        return pl
    pl.material = {"status": "generating", "candidates": pl.material.get("candidates") or _sample_words(random.randrange(10**9))}
    session.add(pl)
    session.commit()
    threading.Thread(target=_generate, args=(pl.id,), daemon=True, name=f"placement-{pl.id}").start()
    return pl


def _generate(pid: int) -> None:
    with Session(engine) as session:
        pl = session.get(Placement, pid)
        if not pl:
            return
        try:
            material = generate_material(session, pl.material["candidates"])
            pl.material = {**pl.material, **material, "status": "ready"}
        except Exception as e:
            log.exception("placement material failed")
            pl.material = {**pl.material, "status": "error", "error": str(e)}
        session.add(pl)
        session.commit()


def generate_material(session: Session, candidates: list[dict]) -> dict:
    p = store.profile(session)
    words = [c["word"] for c in candidates]
    prompt = llm.as_json_block(
        "Create placement-test material for an adult Korean learner of English. Learner profile:",
        {"interests": p["interests"], "self_assessed_level": p["self_level"], "goal": p["goal"]},
    ) + llm.as_json_block(
        "\nCandidate words for a yes/no vocabulary test (lemmas from a frequency list):", words,
    ) + """

Return:
- not_real_words: every candidate that is a proper noun (names, places, brands), abbreviation, foreign
  word, letter sequence, vulgar/offensive word, or otherwise not a normal English dictionary word a
  learner could "know" (copy it exactly).
- pseudowords: 14 made-up but English-looking, pronounceable non-words (e.g. "plinder", "frummage").
  They must not be real words, brand names or slang.
- reading: exactly 3 passages, levels B1, B2 and C1, each 130-190 words, about varied topics touching
  the learner's interests (not all on one topic). Each has 3 multiple-choice questions with 4 choices
  testing gist, detail and inference; answer = index (0-3) of the single correct choice.
- dictation: exactly 8 sentences of natural spoken English, ordered by difficulty
  (A2, B1, B1, B2, B2, C1, C1, C2), 7-22 words each, with contractions, linking and idioms at the
  higher levels, as heard in conversations and TV shows. No names that are hard to spell.
- speaking: 2 prompts like the TOEFL iBT "Take an Interview" task: one about the learner's own life
  or experiences, one asking for an opinion with reasons. seconds = 45 for each.
- writing: one prompt like a short academic-discussion post: a professor's question on a debatable
  topic; min_words 80, max_words 150.
"""
    return llm.call_json(session, "placement", MATERIAL_SCHEMA, max_tokens=12000,
                         messages=[{"role": "user", "content": prompt}])


def _vocab_items(pl: Placement) -> list[dict]:
    m = pl.material
    bad = {w.lower() for w in m.get("not_real_words", [])}
    items: list[dict] = []
    per_band: dict[tuple, int] = {}
    for c in m.get("candidates", []):
        band = tuple(c["band"])
        if c["word"].lower() in bad or per_band.get(band, 0) >= PER_BAND:
            continue
        per_band[band] = per_band.get(band, 0) + 1
        items.append({"word": c["word"], "band": list(band)})
    real = {lem for lem in lexicon.lemma_ranks()}
    for w in m.get("pseudowords", [])[:12]:
        if w.lower() not in real:
            items.append({"word": w.lower(), "band": None})
    random.Random(pl.id).shuffle(items)
    return items


def view(pl: Placement) -> dict:
    """What the client may see (no answers)."""
    m = pl.material
    status = m.get("status", "generating")
    out: dict = {"id": pl.id, "status": status, "error": m.get("error"), "done": sorted(pl.answers.keys()),
                 "finished": pl.finished_at is not None, "result": pl.result}
    if status == "ready":
        out["vocab"] = [i["word"] for i in _vocab_items(pl)]
        out["reading"] = [{"level": r["level"], "title": r["title"], "text": r["text"],
                           "questions": [{"q": q["q"], "choices": q["choices"]} for q in r["questions"]]}
                          for r in m["reading"]]
        out["dictation"] = [{"level": d["level"], "index": i} for i, d in enumerate(m["dictation"])]
        out["speaking"] = m["speaking"]
        out["writing"] = m["writing"]
    return out


def dictation_text(pl: Placement, index: int) -> str:
    return pl.material["dictation"][index]["text"]


# ---------- scoring ----------

def _norm_words(s: str) -> list[str]:
    s = s.lower().replace("’", "'")
    return re.findall(r"[a-z0-9']+", s)


def word_accuracy(ref: str, hyp: str) -> float:
    """1 - word error rate (Levenshtein over words), floored at 0."""
    r, h = _norm_words(ref), _norm_words(hyp)
    if not r:
        return 1.0
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev, d[j] = d[j], cur
    return max(0.0, 1 - d[len(h)] / len(r))


def score_vocab(pl: Placement, answers: dict[str, bool]) -> dict:
    items = _vocab_items(pl)
    pseudo = [i for i in items if i["band"] is None]
    fa = sum(1 for i in pseudo if answers.get(i["word"])) / max(1, len(pseudo))
    total = 0.0
    bands = []
    for lo, hi in BANDS:
        words = [i for i in items if i["band"] == [lo, hi]]
        if not words:
            continue
        hit = sum(1 for i in words if answers.get(i["word"])) / len(words)
        corrected = max(0.0, (hit - fa) / (1 - fa)) if fa < 1 else 0.0
        total += corrected * (hi - lo)
        bands.append({"band": f"{lo}-{hi}", "hit": round(hit, 2), "corrected": round(corrected, 2)})
    return {"estimate": int(round(total, -1)), "false_alarm": round(fa, 2), "bands": bands}


def score_reading(pl: Placement, answers: list[list[int]]) -> dict:
    per = []
    for r, ans in zip(pl.material["reading"], answers, strict=False):
        correct = sum(1 for q, a in zip(r["questions"], ans, strict=False) if q["answer"] == a)
        per.append({"level": r["level"], "correct": correct, "of": len(r["questions"])})
    # B1 passage → up to 3.5, B2 → 4.5, C1 → 6.0 (all correct everywhere = C2 territory)
    weights = {"B1": 1.0, "B2": 1.0, "C1": 1.5}
    est = 2.5 + sum(weights[x["level"]] * x["correct"] / max(1, x["of"]) for x in per)
    return {"passages": per, "estimate": round(min(6.0, est), 2)}


def score_dictation(pl: Placement, answers: list[str]) -> dict:
    per = []
    for d, a in zip(pl.material["dictation"], answers, strict=False):
        per.append({"level": d["level"], "text": d["text"], "answer": a, "accuracy": round(word_accuracy(d["text"], a), 2)})
    # Level = weighted by sentence level: credit each sentence's level step by its accuracy.
    est = 1.5
    for x in per:
        lv = LEVEL_NUM[x["level"]]
        if x["accuracy"] >= 0.85:
            est = max(est, lv + 0.5)
        elif x["accuracy"] >= 0.6:
            est = max(est, lv)
    return {"sentences": per, "estimate": min(6.0, est)}


# ---------- final judgement ----------

RESULT_SCHEMA = obj({
    "levels": obj({"reading": NUM, "listening": NUM, "speaking": NUM, "writing": NUM}),
    "summary_ko": STR,
    "strengths_ko": arr(STR),
    "weaknesses_ko": arr(STR),
    "focus_ko": arr(obj({"title": STR, "why": STR, "how": STR})),
    "speaking_feedback_ko": STR,
    "writing_feedback_ko": STR,
    "writing_improved": STR,
    "outlook_ko": STR,
    "mistakes": arr(mistakes.MISTAKE_ITEM),
})


def finish(session: Session, pl: Placement) -> dict:
    a = pl.answers
    p = store.profile(session)
    evidence = {
        "vocabulary_yes_no_test": a.get("vocab", {}).get("score"),
        "reading_multiple_choice": a.get("reading", {}).get("score"),
        "dictation": a.get("listening", {}).get("score"),
        "speaking": [{"prompt": s.get("prompt"), "transcript": s.get("text"), "stats": s.get("stats")}
                     for s in a.get("speaking", {}).get("items", [])],
        "writing": {"prompt": pl.material.get("writing", {}).get("prompt"), "text": a.get("writing", {}).get("text")},
        "can_do_self_assessment": a.get("self", {}).get("answers"),
        "learner": {"goal": p["goal"], "target_date": p["target_date"], "daily_minutes": p["daily_minutes"],
                    "self_assessed": p["self_level"]},
        "today": datetime.now().date().isoformat(),
    }
    prompt = llm.as_json_block("Placement test evidence for an adult Korean learner of English:", evidence) + """

Judge the learner's CEFR level per skill on a 1.0-6.0 scale (A1=1, A2=2, B1=3, B2=4, C1=5, C2=6;
use decimals, e.g. 4.3 = solid B2, 4.7 = high B2). Reading and listening: start from the objective
estimates and adjust only with good reason. Speaking: judge range, accuracy, fluency (wpm, long
pauses, fillers) and coherence from the transcripts (speech recognition may have smoothed some
errors; low-confidence words hint at pronunciation problems). Writing: CEFR / TOEFL academic
discussion criteria. Missing evidence: estimate conservatively from the other skills.

Write the feedback in Korean (natural, direct, encouraging but honest). focus_ko: the 3 most valuable
things to work on, each with why and how (concrete practice). outlook_ko: a realistic outlook for the
goal by the target date given the daily study time (hours needed for each CEFR step are large; say
plainly what is realistic). writing_improved: the learner's text rewritten one level higher, keeping
their ideas. mistakes: up to 8 recurring error patterns seen in speaking/writing.
"""
    result = llm.call_json(session, "placement", RESULT_SCHEMA, max_tokens=12000,
                           messages=[{"role": "user", "content": prompt}])
    for skill, lv in result["levels"].items():
        levels.record(session, skill, float(lv), "placement", commit=False)
    vocab = a.get("vocab", {}).get("score", {}).get("estimate")
    if vocab:
        lexicon.set_vocab_estimate(session, vocab)
    mistakes.merge(session, result.get("mistakes", []), source="placement")
    pl.result = result
    pl.finished_at = datetime.now()
    session.add(pl)
    store.update_profile(session, {"onboarded": True})
    minutes = max(5.0, min(90.0, (pl.finished_at - pl.created_at).total_seconds() / 60))
    progress.log_activity(session, "placement", minutes, ref_id=pl.id, commit=False)
    session.commit()
    return result
