"""Voice conversation with the AI tutor.

Each learner turn: Whisper transcript → Sonnet reply (with a silent error log and, sometimes, a short
nudge to self-correct) → Edge TTS audio. At the end Opus writes a report: CAF scores (complexity,
accuracy, fluency, pronunciation), top-3 focus areas, upgraded versions of the learner's sentences,
error patterns (→ correction cards) and new facts for the tutor's memory.
"""

from __future__ import annotations

import random
import re
from datetime import datetime

from sqlmodel import Session, select

from app.core import llm, speech, store
from app.core.llm import NUM, STR, arr, obj
from app.learn import levels, lexicon, mistakes, progress
from app.models import Conversation, Message, Reading

MAX_HISTORY = 40  # messages sent to the model per turn

SCENARIOS: dict[str, dict] = {
    "free": {"title": "자유 대화", "desc": "관심사·근황으로 편하게", "mode": "free"},
    "interview": {"title": "TOEFL 인터뷰", "desc": "Take an Interview 4문항 · 45초", "mode": "interview"},
    "immigration": {"title": "입국 심사", "desc": "공항 입국 심사관과 대화", "ai_role": "a US immigration officer at the airport",
                    "user_role": "a traveller arriving for a conference and a short trip", "goal": "get through immigration smoothly"},
    "hotel": {"title": "호텔 체크인 · 문제 해결", "desc": "체크인 후 방 문제를 해결", "ai_role": "a hotel front-desk clerk",
              "user_role": "a guest checking in; later the room has a problem (noise, broken AC)", "goal": "check in and get the problem fixed"},
    "restaurant": {"title": "레스토랑 주문", "desc": "추천받고 알레르기 말하기", "ai_role": "a friendly server at a busy restaurant",
                   "user_role": "a diner with a mild nut allergy", "goal": "order a meal, ask for recommendations, handle the bill"},
    "directions": {"title": "길 묻기 · 대중교통", "desc": "지하철·버스 갈아타기", "ai_role": "a local passer-by at a subway station",
                   "user_role": "a visitor trying to get to a museum", "goal": "find the way and understand the transfer"},
    "smalltalk": {"title": "파티 스몰토크", "desc": "처음 만난 사람과 대화 이어가기", "ai_role": "a curious, chatty guest at a house party",
                  "user_role": "another guest who just arrived", "goal": "keep a natural small-talk conversation going for a few minutes"},
    "conference": {"title": "학회 발표 질의응답", "desc": "내 연구에 대한 질문에 답하기", "ai_role": "an engaged researcher in the audience after the learner's talk",
                   "user_role": "a PhD researcher who just presented their work", "goal": "explain the research clearly and handle follow-up questions"},
    "labmeeting": {"title": "해외 연구실 미팅", "desc": "지도교수와 진행상황 논의", "ai_role": "a supportive but demanding professor at a foreign university",
                   "user_role": "a visiting researcher giving a weekly progress update", "goal": "report progress, explain a problem, agree on next steps"},
    "marathon": {"title": "마라톤 엑스포", "desc": "배번 수령 · 러너와 수다", "ai_role": "a volunteer at a marathon expo, then a fellow runner",
                 "user_role": "a runner picking up their race bib before an international marathon", "goal": "pick up the bib, ask about the course, chat about running"},
    "pharmacy": {"title": "약국 · 병원", "desc": "증상 설명하고 약 사기", "ai_role": "a pharmacist",
                 "user_role": "a traveller with a sore throat and a slight fever", "goal": "describe symptoms and get the right medicine and advice"},
    "complaint": {"title": "전화 항의 · 환불", "desc": "항공권 변경·환불 요청", "ai_role": "an airline customer-service agent on the phone",
                  "user_role": "a customer whose flight was cancelled", "goal": "get rebooked or refunded"},
    "jobinterview": {"title": "박사후연구원 면접", "desc": "연구 경력·계획 말하기", "ai_role": "a hiring professor interviewing for a postdoc position",
                     "user_role": "a candidate for the postdoc", "goal": "present experience and plans convincingly"},
}

INTERVIEW_TOPICS = [
    "how people use technology in daily life", "city life and public transport", "how people stay healthy",
    "education and online learning", "travel and tourism", "work-life balance", "the environment and daily habits",
    "friendship and social media", "hobbies and free time", "food and eating habits",
]

REPLY_SCHEMA = obj({
    "reply": STR,
    "nudge": STR,
    "corrections": arr(obj({"original": STR, "better": STR, "type": {"type": "string", "enum": mistakes.CATEGORIES},
                            "note_ko": STR})),
    "upgrade": STR,
})


def _rate_for(level: float, base: int) -> int:
    # Slightly slower speech for lower levels; the learner's own setting is added on top.
    adj = -15 if level < 3.5 else -8 if level < 4.5 else 0
    return max(-50, min(50, base + adj))


def system_prompt(session: Session, convo: Conversation) -> str:
    cur = levels.current(session)
    lv = cur["levels"]
    speaking = lv.get("speaking") or cur["overall"] or 3.5
    listening = lv.get("listening") or cur["overall"] or 3.5
    p = store.profile(session)
    mem = store.memory(session)
    top = [m.pattern for m in mistakes.top(session, 6)]
    sc = convo.scenario or {}
    lines = [
        "You are a warm, witty, perceptive English conversation partner for an adult Korean learner, inside a "
        "voice app. Your replies are spoken aloud by text-to-speech, so write exactly what should be said: no "
        "markdown, no emoji, no stage directions, no lists.",
        f"Learner: speaking about {lexicon.cefr_label(speaking)}, listening about {lexicon.cefr_label(listening)} "
        f"(1-6 scale: B1=3, B2=4, C1=5, C2=6). Goal: {p['goal']}",
        "Pitch your language one step above their level (i+1): natural, idiomatic, contractions, everyday "
        "phrasal verbs; occasionally use a richer word or idiom they can learn from context. Keep turns short "
        "(usually 1-3 sentences) and end most turns with something easy to respond to, so the learner talks "
        "more than you. Never lecture.",
        "Reply fast and naturally; keep your private deliberation brief.",
        "Errors: list every real error in the learner's LAST message only in `corrections` (never repeat errors from "
        "earlier turns; silent log, shown later; max 4; ignore punctuation/capitalisation and speech-recognition "
        "artefacts). Only when an error blocks "
        "meaning or is one of their recurring patterns, put a short English `nudge` that helps them self-correct "
        "without giving the answer (e.g. \"Check the verb: 'Yesterday I go...'\"); at most one nudge every few "
        "turns, otherwise empty. You may also recast naturally inside your reply. `upgrade`: how a fluent "
        "speaker would say the learner's last message (one sentence, keep their meaning), or empty if it was "
        "already natural.",
        "If the learner writes Korean or asks how to say something, help briefly in English (a Korean gloss in "
        "parentheses is fine), then continue.",
    ]
    if top:
        lines.append("Their recurring error patterns (nudge these when they appear): " + "; ".join(top))
    if mem:
        lines.append("What you remember about the learner from earlier conversations:\n- " + "\n- ".join(mem))
    lines.append(f"Interests: {', '.join(p['interests'])}.")
    if convo.mode == "free":
        lines.append("Mode: free conversation. Pick up naturally from what you remember (ask about something they "
                     "mentioned before), or start with a fresh, specific question. Follow their lead.")
    elif convo.mode == "interview":
        lines.append("Mode: TOEFL iBT 'Take an Interview' simulation. You are an interviewer for a research study on "
                     f"{sc.get('topic', 'how people use technology in daily life')}. Ask exactly 4 questions, one per "
                     "turn, moving from personal experience to opinion and a more abstract/hypothetical question. "
                     "React with one short neutral sentence before the next question. No nudges in this mode. After the "
                     "learner answers the 4th question, thank them and say the interview is over.")
    elif convo.mode == "reading":
        lines.append(f"Mode: discussing a text the learner just read.\nTitle: {sc.get('title')}\nSummary: "
                     f"{sc.get('summary')}\nOpening question: {sc.get('talk_prompt')}\nAsk about their views, connect "
                     "to their life, and reuse the text's key vocabulary: " + ", ".join(sc.get("targets", [])[:10]))
    else:
        lines.append(f"Mode: role-play. You are {sc.get('ai_role')}. The learner is {sc.get('user_role')}. "
                     f"Their goal: {sc.get('goal')}. Setting details: {sc.get('setting', 'use realistic details')}. "
                     "Stay in character, add one or two realistic complications, and let the learner do the work.")
    return "\n\n".join(lines)


def _history(session: Session, convo: Conversation) -> list[dict]:
    msgs = session.exec(select(Message).where(Message.conversation_id == convo.id, Message.replaced == False)  # noqa: E712
                        .order_by(Message.id)).all()
    out = [{"role": "user", "content": "(The learner has joined. Start the conversation with your first line.)"}]
    for m in msgs[-MAX_HISTORY:]:
        out.append({"role": m.role, "content": m.text})
    return out


def _ask(session: Session, convo: Conversation) -> dict:
    system = system_prompt(session, convo)
    return llm.call_json(
        session, "talk", REPLY_SCHEMA, max_tokens=4000,
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        messages=_history(session, convo),
    )


def _speak(session: Session, text: str) -> str | None:
    p = store.profile(session)
    lv = levels.current(session)["levels"].get("listening") or 4.0
    # Returned before the audio exists; the client's request for the clip waits until it is ready.
    return speech.synthesize_async(text, p["voice"], _rate_for(lv, int(p["tts_rate"])))


def start(session: Session, scenario_key: str, custom: str | None = None, reading_id: int | None = None) -> tuple[Conversation, dict]:
    if reading_id:
        r = session.get(Reading, reading_id)
        if not r:
            raise ValueError("읽기 자료를 찾을 수 없어요.")
        sc = {"title": r.title, "summary": (r.data or {}).get("summary_ko"), "talk_prompt": (r.data or {}).get("talk_prompt"),
              "targets": [t["term"] for t in (r.data or {}).get("targets", [])]}
        mode, title = "reading", f"읽기 토론: {r.title}"
    elif scenario_key == "custom":
        if not (custom or "").strip():
            raise ValueError("상황을 적어 주세요.")
        sc = {"ai_role": "the other person in the situation the learner described",
              "user_role": "themselves", "goal": "handle this situation in English", "setting": custom.strip()}
        mode, title = "roleplay", "내 상황: " + custom.strip()[:40]
    else:
        base = SCENARIOS.get(scenario_key)
        if not base:
            raise ValueError("알 수 없는 상황이에요.")
        sc = {k: v for k, v in base.items() if k not in ("title", "desc", "mode")}
        mode = base.get("mode", "roleplay")
        if mode == "interview":
            sc["topic"] = random.choice(INTERVIEW_TOPICS)
        title = base["title"]
    convo = Conversation(created_at=datetime.now(), mode=mode, title=title, scenario=sc, reading_id=reading_id)
    session.add(convo)
    session.commit()
    session.refresh(convo)
    try:
        out = _ask(session, convo)
    except Exception:
        session.delete(convo)  # don't leave an empty conversation behind when the AI is unavailable
        session.commit()
        raise
    msg = _add(session, convo, "assistant", out["reply"])
    return convo, {"message": message_view(msg), "audio": _speak(session, out["reply"])}


def _add(session: Session, convo: Conversation, role: str, text: str, **kw) -> Message:
    m = Message(conversation_id=convo.id, created_at=datetime.now(), role=role, text=text, **kw)
    session.add(m)
    session.commit()
    session.refresh(m)
    return m


def message_view(m: Message) -> dict:
    return {"id": m.id, "role": m.role, "text": m.text, "data": m.data, "audio_seconds": m.audio_seconds,
            "words": m.words, "replaced": m.replaced, "created_at": m.created_at.isoformat(timespec="seconds")}


def transcribe(audio: bytes) -> dict:
    """Step 1 of a voice turn: show the learner's words right away, before the slower AI reply."""
    tr = speech.transcribe(audio)
    if not tr.text.strip():
        raise ValueError("말한 내용을 알아듣지 못했어요. 다시 말해 주세요.")
    return {"text": tr.text, "stats": tr.stats(), "seconds": tr.seconds}


def turn(session: Session, convo: Conversation, *, text: str | None = None, audio: bytes | None = None,
         retry: bool = False, stats: dict | None = None) -> dict:
    if convo.ended_at:
        raise ValueError("이미 끝난 대화예요.")
    seconds = stats.get("seconds") if stats else None
    if audio is not None:
        tr = speech.transcribe(audio)
        text = tr.text
        stats = tr.stats()
        seconds = tr.seconds
    text = (text or "").strip()
    if not text:
        raise ValueError("말한 내용을 알아듣지 못했어요. 다시 말해 주세요.")
    if retry:  # self-correction: the previous attempt and the reply to it drop out of the history
        last = session.exec(select(Message).where(Message.conversation_id == convo.id, Message.replaced == False)  # noqa: E712
                            .order_by(Message.id.desc()).limit(2)).all()
        if len(last) == 2 and last[0].role == "assistant" and last[1].role == "user":
            for m in last:
                m.replaced = True
                session.add(m)
            session.commit()
    user = _add(session, convo, "user", text, audio_seconds=seconds,
                words=len(re.findall(r"[A-Za-z']+", text)), data={"stats": stats} if stats else {})
    out = _ask(session, convo)
    user.data = {**(user.data or {}), "corrections": out["corrections"], "upgrade": out["upgrade"]}
    session.add(user)
    session.commit()
    reply = _add(session, convo, "assistant", out["reply"], data={"nudge": out["nudge"]} if out["nudge"] else {})
    return {"user": message_view(user), "assistant": message_view(reply), "audio": _speak(session, out["reply"])}


HELP_SCHEMA = obj({"options": arr(obj({"en": STR, "note_ko": STR}))})


def help_say(session: Session, convo: Conversation, korean: str) -> dict:
    """'영어로 어떻게 말해?' — 2-3 natural ways to say it, fitting the conversation so far."""
    last = [m.text for m in session.exec(select(Message).where(Message.conversation_id == convo.id, Message.replaced == False)  # noqa: E712
                                         .order_by(Message.id.desc()).limit(4)).all()][::-1]
    prompt = (f"Recent conversation:\n{chr(10).join(last)}\n\nThe Korean learner wants to say: {korean}\n"
              "Give 2-3 natural spoken ways to say it in this context (casual to more polished), each with a very "
              "short Korean note on nuance.")
    return llm.call_json(session, "talk", HELP_SCHEMA, max_tokens=2000, messages=[{"role": "user", "content": prompt}])


# ---------- the report ----------

REPORT_SCHEMA = obj({
    "summary_ko": STR,
    "level": NUM,
    "scores": obj({"accuracy": NUM, "complexity": NUM, "fluency": NUM, "pronunciation": NUM}),
    "caf_ko": obj({"accuracy": STR, "complexity": STR, "fluency": STR, "pronunciation": STR}),
    "focus": arr(obj({"title_ko": STR, "why_ko": STR, "practice_en": STR})),
    "mistakes": arr(mistakes.MISTAKE_ITEM),
    "upgrades": arr(obj({"original": STR, "better": STR, "why_ko": STR})),
    "expressions": arr(obj({"expr": STR, "meaning_ko": STR, "example": STR})),
    "toefl_band": NUM,
    "memory_add": arr(STR),
    "memory_remove": arr(STR),
    "next_ko": STR,
})


def metrics(msgs: list[Message]) -> dict:
    users = [m for m in msgs if m.role == "user" and not m.replaced]
    words = sum(m.words or 0 for m in users)
    speech_s = sum((m.data or {}).get("stats", {}).get("seconds", 0) or 0 for m in users)
    voiced = [m for m in users if (m.data or {}).get("stats")]
    wpm_vals = [(m.data["stats"]["wpm"], m.words or 0) for m in voiced if m.data["stats"].get("wpm")]
    wpm = round(sum(w * n for w, n in wpm_vals) / max(1, sum(n for _, n in wpm_vals))) if wpm_vals else None
    fillers = sum(m.data["stats"].get("fillers", 0) for m in voiced)
    pauses = sum(m.data["stats"].get("long_pauses", 0) for m in voiced)
    errors = sum(len((m.data or {}).get("corrections") or []) for m in users)
    toks = [lexicon.lemmatize(t) for m in users for t in re.findall(r"[A-Za-z']+", m.text)]
    # moving-average type/token ratio over 40-word windows (length-independent lexical diversity)
    win = 40
    if len(toks) >= win:
        mattr = sum(len(set(toks[i:i + win])) / win for i in range(len(toks) - win + 1)) / (len(toks) - win + 1)
    else:
        mattr = len(set(toks)) / len(toks) if toks else None
    return {
        "turns": len(users), "words": words, "speaking_seconds": round(speech_s), "wpm": wpm,
        "words_per_turn": round(words / len(users), 1) if users else 0,
        "errors_per_100w": round(errors * 100 / words, 1) if words else None,
        "fillers_per_100w": round(fillers * 100 / words, 1) if words and voiced else None,
        "long_pauses": pauses, "lexical_diversity": round(mattr, 3) if mattr else None,
    }


def end(session: Session, convo: Conversation) -> dict:
    msgs = list(session.exec(select(Message).where(Message.conversation_id == convo.id).order_by(Message.id)).all())
    convo.ended_at = datetime.now()
    last_at = msgs[-1].created_at if msgs else convo.created_at
    convo.minutes = round(max(0.5, min(120.0, (last_at - convo.created_at).total_seconds() / 60 + 0.5)), 1)
    convo.metrics = metrics(msgs)
    session.add(convo)
    session.commit()
    users = [m for m in msgs if m.role == "user" and not m.replaced]
    if len(users) < 2:
        progress.log_activity(session, "talk", convo.minutes, ref_id=convo.id)
        return {"report": None, "metrics": convo.metrics, "note": "대화가 짧아서 리포트는 만들지 않았어요."}
    transcript = [
        {"who": "learner" if m.role == "user" else "tutor", "text": m.text,
         **({"speech": (m.data or {}).get("stats"), "logged_corrections": (m.data or {}).get("corrections")}
            if m.role == "user" else {})}
        for m in msgs if not m.replaced
    ]
    cur = levels.current(session)
    prompt = llm.as_json_block(
        f"Conversation ({convo.mode}: {convo.title}) between an adult Korean learner of English and an AI tutor. "
        "Learner turns include speech stats from speech recognition (wpm, long pauses, fillers, low-confidence "
        "'unclear_words' that often signal pronunciation problems) and corrections logged live:", transcript,
    ) + llm.as_json_block("\nSession metrics:", convo.metrics) + llm.as_json_block(
        "\nLearner's current estimated levels (1-6):", cur["levels"],
    ) + llm.as_json_block("\nWhat the tutor already remembers:", store.memory(session)) + """

Write a feedback report in Korean (direct, specific, encouraging; quote the learner's words).
- level: speaking level shown in THIS conversation on the 1-6 CEFR scale (decimals).
- scores: 1-6 for accuracy, complexity (range of grammar/vocabulary), fluency, pronunciation (judge
  pronunciation only from the indirect evidence; stay near the overall level if unclear).
- caf_ko: one or two sentences per dimension.
- focus: the 3 most valuable things to practise next, each with a short English drill sentence/pattern.
- mistakes: recurring error patterns (pattern = short reusable English label like "missing article
  before singular countable nouns"), with one real example from this conversation each. Max 8.
- upgrades: 3-6 of the learner's sentences rewritten as a fluent speaker one level higher would say them.
- expressions: 4-8 useful expressions (from the tutor's turns or what the learner needed) worth a flashcard.
- toefl_band: estimated TOEFL iBT speaking band (1-6, halves) if this were scored.
- memory_add: new lasting facts about the learner worth remembering (plans, interests, life events,
  preferences); memory_remove: remembered facts that are now outdated (copy exactly). Keep both short.
- next_ko: one suggestion for the next conversation.
"""
    report = llm.call_json(session, "talk_report", REPORT_SCHEMA, max_tokens=12000,
                           messages=[{"role": "user", "content": prompt}])
    convo.report = report
    session.add(convo)
    levels.record(session, "speaking", float(report["level"]), "talk", note=convo.title[:80], commit=False)
    session.commit()
    mistakes.merge(session, report.get("mistakes", []), source="talk", source_id=convo.id)
    store.remember(session, report.get("memory_add", []), report.get("memory_remove", []))
    progress.log_activity(session, "talk", convo.minutes, ref_id=convo.id)
    return {"report": report, "metrics": convo.metrics}


def convo_view(session: Session, c: Conversation, full: bool = False) -> dict:
    out = {"id": c.id, "mode": c.mode, "title": c.title, "created_at": c.created_at.isoformat(timespec="minutes"),
           "ended_at": c.ended_at.isoformat(timespec="minutes") if c.ended_at else None, "minutes": c.minutes,
           "metrics": c.metrics, "level": (c.report or {}).get("level")}
    if full:
        msgs = session.exec(select(Message).where(Message.conversation_id == c.id).order_by(Message.id)).all()
        out |= {"messages": [message_view(m) for m in msgs], "report": c.report, "scenario": c.scenario}
    return out
