"""Claude Code CLI (`claude -p`) as an AI backend, billed to the user's Claude subscription (no API key).

One call = one CLI process with tools disabled, settings files ignored and no session saved. The system
prompt goes in `--system-prompt`, structured output is enforced with `--json-schema`, and the rest of
the request (including earlier conversation turns, flattened) is sent on stdin.
"""

from __future__ import annotations

import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

# The CLI would bill the API instead of the subscription if it saw an API key.
ENV_DROP = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")
_FLAGS = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
_status_cache: dict = {}
_workdir = Path(tempfile.gettempdir()) / "englishlab-cli"  # empty folder: no project CLAUDE.md is loaded


class CliError(Exception):
    def __init__(self, message: str, rate_limited: bool = False):
        super().__init__(message)
        self.rate_limited = rate_limited


def _env() -> dict:
    env = {k: v for k, v in os.environ.items() if k not in ENV_DROP}
    env.setdefault("PYTHONIOENCODING", "utf-8")
    return env


def _ver_key(p: str) -> tuple:
    nums = re.findall(r"(\d+)\.(\d+)\.(\d+)", p)
    v = tuple(int(x) for x in nums[-1]) if nums else (0, 0, 0)
    try:
        return (*v, os.path.getmtime(p))
    except OSError:
        return (*v, 0)


def find_exe() -> str | None:
    """Explicit env var → PATH → the CLI bundled with the Claude desktop app (newest version).

    The desktop app has kept it in different places over time: %APPDATA%\\Claude\\claude-code (also
    virtualised under %LOCALAPPDATA%\\Packages\\Claude_*\\LocalCache) and, in newer builds,
    %LOCALAPPDATA%\\Claude-Data\\<package>\\claude-code\\<ver>\\<hash>."""
    if p := os.environ.get("ENGLISHLAB_CLAUDE_EXE"):
        return p if Path(p).exists() else None
    if p := shutil.which("claude"):
        return p
    home = Path.home()
    roaming = Path(os.environ.get("APPDATA") or home / "AppData" / "Roaming")
    local = Path(os.environ.get("LOCALAPPDATA") or home / "AppData" / "Local")
    packages = glob.glob(str(local / "Packages" / "Claude_*"))
    cands: list[str] = []
    for r in [roaming, *(Path(p) / "LocalCache" / "Roaming" for p in packages)]:
        cands += glob.glob(str(r / "Claude" / "claude-code" / "*" / "*" / "claude.exe"))
        cands += glob.glob(str(r / "Claude" / "claude-code" / "*" / "claude.exe"))
    for r in [local, *(Path(p) / "LocalCache" / "Local" for p in packages)]:
        cands += glob.glob(str(r / "Claude-Data" / "*" / "claude-code" / "*" / "*" / "claude.exe"))
    for local_bin in (home / ".local" / "bin" / "claude.exe", home / ".local" / "bin" / "claude",
                      home / ".claude" / "local" / "claude", Path("/usr/local/bin/claude")):
        if local_bin.exists():
            cands.append(str(local_bin))
    return max(cands, key=_ver_key) if cands else None


def _quick(argv: list[str], timeout: float = 20) -> tuple[int, str]:
    try:
        out = subprocess.run(argv, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout,
                             creationflags=_FLAGS, stdin=subprocess.DEVNULL, env=_env(), check=False)
        return out.returncode, (out.stdout or "") + (out.stderr or "")
    except (OSError, subprocess.TimeoutExpired) as e:
        return -1, str(e)


def status(refresh: bool = False) -> dict:
    """{available, path, version, logged_in, reason}; cached for a few minutes."""
    exe = find_exe()
    if not exe:
        return {"available": False, "path": None, "version": None, "logged_in": False,
                "reason": "claude 실행 파일을 찾지 못했어요 (Claude 데스크톱 앱 또는 npm i -g @anthropic-ai/claude-code)."}
    cached = _status_cache.get(exe)
    if cached and not refresh and time.time() - cached[0] < (300 if cached[1]["available"] else 60):
        return cached[1]
    rc, out = _quick([exe, "--version"])
    st = {"available": rc == 0, "path": exe, "version": out.strip().splitlines()[0] if out.strip() else None,
          "logged_in": None, "reason": None if rc == 0 else out[:200]}
    if rc == 0:
        rc2, out2 = _quick([exe, "auth", "status"])
        try:
            st["logged_in"] = bool(json.loads(out2[out2.index("{"):out2.rindex("}") + 1]).get("loggedIn"))
        except ValueError:
            st["logged_in"] = None  # older CLI: can't tell, try anyway
        if st["logged_in"] is False:
            st.update(available=False, reason="Claude CLI 로그인이 필요해요. 터미널에서 claude를 실행하고 /login 하세요.")
    _status_cache[exe] = (time.time(), st)
    return st


def flatten(messages: list[dict]) -> str:
    """Messages API turns → one prompt. A single user turn is sent as is; a conversation becomes a transcript."""
    def text(content) -> str:
        if isinstance(content, str):
            return content
        return "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")

    if len(messages) == 1 and messages[0]["role"] == "user":
        return text(messages[0]["content"])
    lines = ["<conversation>"]
    for m in messages:
        lines.append(f"[{m['role']}]: {text(m['content'])}")
    lines.append("</conversation>")
    lines.append("Write the next [assistant] turn, following the system prompt. Respond to the last [user] message.")
    return "\n".join(lines)


WEB_TOOLS = ["WebSearch", "WebFetch"]


def run(*, system: str, prompt: str, model: str, effort: str, schema: dict | None, timeout_s: float = 300,
        tools: list[str] | None = None, images: list[bytes] | None = None) -> dict:
    """→ {text, structured, model, usage, equiv_usd, duration_s}. Raises CliError.

    `tools` enables (and pre-approves) built-in tools, e.g. WEB_TOOLS for research. `images` are PNGs the
    model reads with the Read tool from the empty work folder (the CLI takes no image input on stdin)."""
    st = status()
    if not st["available"]:
        raise CliError(st["reason"] or "Claude CLI를 쓸 수 없어요.")
    tools = list(tools or [])
    _workdir.mkdir(exist_ok=True)
    files: list[Path] = []
    for data in images or []:
        f = _workdir / f"img-{uuid.uuid4().hex[:12]}.png"
        f.write_bytes(data)
        files.append(f)
    if files:
        tools.append("Read")
        names = ", ".join(f"./{f.name}" for f in files)
        prompt = f"First read the image file(s) {names} with the Read tool.\n\n{prompt}"
    argv = [st["path"], "-p", "--output-format", "json", "--model", model, "--effort", effort,
            "--no-session-persistence", "--tools", ",".join(tools), "--strict-mcp-config", "--disable-slash-commands",
            "--setting-sources", ""]
    if tools:
        argv += ["--allowedTools", ",".join(tools)]
    if system:
        argv += ["--system-prompt", system]
    if schema:
        argv += ["--json-schema", json.dumps(schema, ensure_ascii=False)]
    t0 = time.time()
    try:
        proc = subprocess.run(argv, input=prompt, capture_output=True, text=True, encoding="utf-8", errors="replace",
                              timeout=timeout_s, creationflags=_FLAGS, env=_env(), cwd=str(_workdir), check=False)
    except subprocess.TimeoutExpired as e:
        raise CliError(f"AI 응답이 {int(timeout_s)}초 안에 오지 않았어요. 다시 시도해 주세요.") from e
    except OSError as e:
        raise CliError(f"Claude CLI를 실행하지 못했어요: {e}") from e
    finally:
        for f in files:
            f.unlink(missing_ok=True)
    out = proc.stdout.strip()
    try:
        data = json.loads(out[out.index("{"):]) if "{" in out else {}
    except ValueError:
        data = {}
    if not data:
        err = (proc.stderr or out or f"exit {proc.returncode}").strip()[-500:]
        raise CliError(_explain(err), rate_limited=_is_limit(err))
    if data.get("is_error") or data.get("subtype", "success") != "success":
        err = str(data.get("result") or data.get("subtype") or "error")
        if "login" in err.lower():
            _status_cache.clear()
        raise CliError(_explain(err), rate_limited=_is_limit(err))
    usage = data.get("usage") or {}
    model_used = next(iter(data.get("modelUsage") or {}), model)
    return {
        "text": data.get("result") or "",
        "structured": data.get("structured_output"),
        "model": model_used,
        "usage": usage,
        "equiv_usd": float(data.get("total_cost_usd") or 0.0),
        "duration_s": time.time() - t0,
    }


def _is_limit(text: str) -> bool:
    t = text.lower()
    return "rate limit" in t or "usage limit" in t or "429" in t or "limit reached" in t


def _explain(err: str) -> str:
    low = err.lower()
    if _is_limit(err):
        return "Claude 구독 사용 한도에 걸렸어요. 잠시 후 다시 시도하거나 설정에서 API 키 방식으로 바꿔 주세요."
    if "login" in low or "authenticate" in low:
        return "Claude CLI 로그인이 필요해요. 터미널에서 claude를 실행하고 /login 하세요."
    return f"Claude CLI 오류: {err[:300]}"
