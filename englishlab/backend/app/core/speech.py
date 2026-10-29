"""Speech: local Whisper (GPU) for the learner's voice, Microsoft Edge neural voices for the tutor.

- STT runs faster-whisper on CUDA (CPU int8 as a fallback). Audio is decoded with ffmpeg, so any
  browser recording format (webm/opus, mp4/aac, wav) works.
- TTS uses edge-tts (free online neural voices) and caches each clip with per-word timings, which the
  reader uses to highlight words as they are spoken.
"""

from __future__ import annotations

import asyncio
import glob
import hashlib
import json
import logging
import os
import re
import subprocess
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from app.config import STT_ENABLED, STT_MODEL, TTS_DIR

log = logging.getLogger("englishlab.speech")

# CUDA runtime DLLs ship as pip wheels (nvidia-cublas-cu12, nvidia-cudnn-cu12); make them loadable.
for _d in glob.glob(os.path.join(sys.prefix, "Lib", "site-packages", "nvidia", "*", "bin")):
    if hasattr(os, "add_dll_directory"):
        os.add_dll_directory(_d)
    os.environ["PATH"] = _d + os.pathsep + os.environ.get("PATH", "")
# Linux reads LD_LIBRARY_PATH only at start-up, so preload the wheels' libraries before CTranslate2 needs them.
if sys.platform.startswith("linux"):
    import ctypes

    for _so in sorted(glob.glob(os.path.join(sys.prefix, "lib", "python3*", "site-packages", "nvidia", "*", "lib", "lib*.so*"))):
        try:
            ctypes.CDLL(_so, mode=ctypes.RTLD_GLOBAL)
        except OSError:
            pass

VOICES: list[dict[str, str]] = [
    {"id": "en-US-AvaMultilingualNeural", "label": "Ava (미국 · 여)"},
    {"id": "en-US-AndrewMultilingualNeural", "label": "Andrew (미국 · 남)"},
    {"id": "en-US-EmmaMultilingualNeural", "label": "Emma (미국 · 여)"},
    {"id": "en-US-BrianMultilingualNeural", "label": "Brian (미국 · 남)"},
    {"id": "en-GB-SoniaNeural", "label": "Sonia (영국 · 여)"},
    {"id": "en-GB-RyanNeural", "label": "Ryan (영국 · 남)"},
    {"id": "en-AU-NatashaNeural", "label": "Natasha (호주 · 여)"},
    {"id": "en-AU-WilliamMultilingualNeural", "label": "William (호주 · 남)"},
    {"id": "en-CA-ClaraNeural", "label": "Clara (캐나다 · 여)"},
    {"id": "en-IE-ConnorNeural", "label": "Connor (아일랜드 · 남)"},
]
VOICE_IDS = {v["id"] for v in VOICES}
DEFAULT_VOICE = "en-US-AvaMultilingualNeural"

FILLERS = {"um", "uh", "er", "erm", "hmm", "uhm", "ah"}


class SpeechError(Exception):
    pass


# ---------- audio decoding ----------

def decode_audio(data: bytes) -> np.ndarray:
    """Any container/codec → mono 16 kHz float32 via ffmpeg."""
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    try:
        proc = subprocess.run(
            ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
             "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"],
            input=data, capture_output=True, timeout=60, creationflags=flags, check=False,
        )
    except FileNotFoundError as e:
        raise SpeechError("ffmpeg가 설치되어 있지 않아요.") from e
    if proc.returncode != 0 or not proc.stdout:
        raise SpeechError("녹음 파일을 읽지 못했어요.")
    return np.frombuffer(proc.stdout, np.int16).astype(np.float32) / 32768.0


# ---------- speech to text ----------

@dataclass
class Transcript:
    text: str
    seconds: float  # length of the recording
    speech_seconds: float  # from first to last word (pauses before/after excluded)
    words: list[dict] = field(default_factory=list)  # {w, start, end, p}

    @property
    def word_count(self) -> int:
        return len(re.findall(r"[A-Za-z']+", self.text))

    def stats(self) -> dict:
        n = self.word_count
        minutes = max(self.speech_seconds, 1.0) / 60
        low = [w["w"] for w in self.words if w["p"] < 0.5]
        fillers = sum(1 for w in self.words if re.sub(r"[^a-z]", "", w["w"].lower()) in FILLERS)
        pauses = sum(1 for a, b in zip(self.words, self.words[1:], strict=False) if b["start"] - a["end"] > 1.0)
        return {
            "words": n,
            "seconds": round(self.seconds, 1),
            "wpm": round(n / minutes) if n else 0,
            "long_pauses": pauses,
            "fillers": fillers,
            "unclear_words": low[:12],  # low-confidence words: often pronunciation trouble
        }


_model = None
_model_lock = threading.Lock()
_model_device = "none"


def _load_model():
    global _model, _model_device
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        if not STT_ENABLED:
            raise SpeechError("음성 인식이 꺼져 있어요.")
        from faster_whisper import WhisperModel

        try:
            _model = WhisperModel(STT_MODEL, device="cuda", compute_type="float16")
            _model_device = "cuda"
            # A first tiny transcription loads cuBLAS/cuDNN now instead of on the learner's first turn.
            list(_model.transcribe(np.zeros(16000, np.float32), language="en")[0])
        except Exception as e:  # no GPU / driver problem → CPU
            log.warning("Whisper on CUDA failed (%s); using CPU", e)
            _model = WhisperModel("small.en" if STT_MODEL.startswith("large") else STT_MODEL,
                                  device="cpu", compute_type="int8")
            _model_device = "cpu"
        return _model


def preload_async() -> None:
    if STT_ENABLED:
        threading.Thread(target=lambda: _safe(_load_model), daemon=True, name="whisper-preload").start()


def _safe(fn):
    try:
        fn()
    except Exception as e:
        log.warning("speech preload failed: %s", e)


def stt_status() -> dict:
    return {"enabled": STT_ENABLED, "loaded": _model is not None, "device": _model_device, "model": STT_MODEL}


_transcribe_lock = threading.Lock()


def transcribe(data: bytes, prompt: str | None = None) -> Transcript:
    audio = decode_audio(data)
    seconds = len(audio) / 16000
    if seconds < 0.3:
        raise SpeechError("녹음이 너무 짧아요.")
    model = _load_model()
    with _transcribe_lock:  # one GPU job at a time
        segments, _info = model.transcribe(
            audio, language="en", beam_size=5, word_timestamps=True, vad_filter=True,
            # Keeps disfluencies ("um", "uh") instead of cleaning them up, so fluency stats are honest.
            initial_prompt=prompt or "Umm, let me think... I, uh, I went there last week.",
            condition_on_previous_text=False,
        )
        segs = list(segments)
    words = [
        {"w": w.word.strip(), "start": round(w.start, 2), "end": round(w.end, 2), "p": round(float(w.probability), 2)}
        for s in segs for w in (s.words or [])
    ]
    text = " ".join(s.text.strip() for s in segs).strip()
    speech = (words[-1]["end"] - words[0]["start"]) if words else 0.0
    return Transcript(text=text, seconds=seconds, speech_seconds=speech, words=words)


# ---------- text to speech ----------

def _rate(rate: int) -> str:
    rate = max(-50, min(50, int(rate)))
    return f"{rate:+d}%"


def tts_key(text: str, voice: str, rate: int) -> str:
    return hashlib.sha1(f"{voice}|{_rate(rate)}|{text}".encode()).hexdigest()[:20]


def tts_paths(key: str) -> tuple[Path, Path]:
    return TTS_DIR / f"{key}.mp3", TTS_DIR / f"{key}.json"


async def _synthesize(text: str, voice: str, rate: int, mp3: Path) -> list[dict]:
    import edge_tts

    comm = edge_tts.Communicate(text, voice, rate=_rate(rate), boundary="WordBoundary")
    marks: list[dict] = []
    tmp = mp3.with_suffix(".part")
    with tmp.open("wb") as f:
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                # offsets are in 100 ns ticks
                marks.append({"w": chunk["text"], "t": round(chunk["offset"] / 1e7, 3),
                              "d": round(chunk["duration"] / 1e7, 3)})
    tmp.replace(mp3)
    return marks


_inflight: dict[str, threading.Event] = {}
_inflight_lock = threading.Lock()


def synthesize_async(text: str, voice: str | None = None, rate: int = 0) -> str:
    """Start synthesis in the background and return the clip key at once.

    The online voice service sometimes takes several seconds, so a reply's text can be shown before its
    audio exists; GET /api/tts/{key}.mp3 waits for the clip (see wait_for)."""
    text = re.sub(r"\s+", " ", text).strip()
    voice = voice if voice in VOICE_IDS else DEFAULT_VOICE
    key = tts_key(text, voice, rate)
    mp3, meta = tts_paths(key)
    if mp3.exists() and meta.exists():
        return key
    with _inflight_lock:
        if key in _inflight:
            return key
        done = _inflight[key] = threading.Event()

    def work() -> None:
        try:
            synthesize(text, voice, rate)
        except SpeechError as e:
            log.warning("tts failed: %s", e)
        finally:
            done.set()
            with _inflight_lock:
                _inflight.pop(key, None)

    threading.Thread(target=work, daemon=True, name=f"tts-{key}").start()
    return key


def wait_for(key: str, timeout: float = 30) -> bool:
    """True once the clip exists (waiting for an in-flight synthesis if there is one)."""
    mp3, _ = tts_paths(key)
    if mp3.exists():
        return True
    with _inflight_lock:
        ev = _inflight.get(key)
    if ev:
        ev.wait(timeout)
    return mp3.exists()


def synthesize(text: str, voice: str | None = None, rate: int = 0) -> dict:
    """Synthesize (or reuse) a clip. Returns {key, marks}. Safe to call from worker threads."""
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        raise SpeechError("읽을 내용이 없어요.")
    if len(text) > 6000:
        raise SpeechError("한 번에 읽기에는 너무 길어요.")
    voice = voice if voice in VOICE_IDS else DEFAULT_VOICE
    key = tts_key(text, voice, rate)
    mp3, meta = tts_paths(key)
    if mp3.exists() and meta.exists():
        return {"key": key, "marks": json.loads(meta.read_text(encoding="utf-8"))}
    try:
        marks = asyncio.run(_synthesize(text, voice, rate, mp3))
    except Exception as e:
        raise SpeechError("음성 합성에 실패했어요. 인터넷 연결을 확인해 주세요.") from e
    meta.write_text(json.dumps(marks), encoding="utf-8")
    return {"key": key, "marks": marks}
