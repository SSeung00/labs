# EnglishLab

A personal, AI-heavy English study app for a Korean adult learner going from B1–B2 towards C2
(travel and daily communication abroad, Netflix without subtitles, TOEFL iBT band 6).
Same stack as the other Lab apps: FastAPI + SQLite backend serving a React PWA on one port,
PIN lock for the phone over Tailscale.

- PC: runs as a background service (`englishlab-service.pyw`, no console window) that starts at Windows
  log-in. `install-autostart.bat` sets that up once and adds "EnglishLab" to the Start menu and desktop
  (opens the app in its own window); `start-englishlab.bat` opens it, `stop-englishlab.bat` stops it,
  `start-englishlab-console.bat` runs it in a visible console instead. The same switches are in Settings → PC 앱.
  While running, the service restarts the server when backend code changes and rebuilds the web app when
  frontend files change; open apps (phone included) pick up the new build. Logs: `data/logs/`.
- Phone: `tailscale serve --bg --https=10002 8005` (once; it persists), set a PIN on the PC in
  Settings → 휴대폰에서 보기, then open the address/QR shown there and add it to the home screen.
  The microphone only works on the https address. Keep the PC from sleeping while plugged in.

### Linux

- `./setup.sh` once (and again after pulling changes): `uv sync`, `npm ci`, web build. Needs [uv](https://docs.astral.sh/uv/) and Node.js 20+.
- `./install-autostart.sh` installs a systemd user service `englishlab.service`, which runs `englishlab-service.pyw` with
  `backend/.venv/bin/python` (the same supervisor as on Windows: keeps uvicorn alive, rebuilds the web app, restarts on
  backend edits), plus an app-menu launcher (`~/.local/share/applications/englishlab.desktop`), and opens the app window
  (a Chromium-family browser in `--app` mode, falling back to the default browser).
- `./start-englishlab.sh` / `./stop-englishlab.sh` / `./uninstall-autostart.sh` mirror the `.bat` files (uninstalling
  keeps the app-menu launcher; delete the `.desktop` file if you like).
- Status: `systemctl --user status englishlab`; logs: `data/logs/`.
- To keep it reachable from the phone while you are logged out: `loginctl enable-linger "$USER"`.
- On Linux, `tailscale serve` needs `sudo tailscale set --operator=$USER` once so it can run without sudo.

## What it does

| Area | Features |
|---|---|
| 오늘 (Today) | Today's course from the study plan (what is left of this week's minutes per block, spread over the days left; book sessions as their own blocks) or an input-heavy default split, daily goal ring, streak with 2 freezes per week, AI coach note (Haiku), Netflix/podcast time log, plan status card |
| 레벨 진단 (Placement) | CEFR can-do self-check, yes/no vocabulary test with pseudowords (frequency bands up to 16k lemmas), 3 reading passages (B1/B2/C1), 8-sentence dictation, 2 TOEFL-style interview answers (voice), one academic-discussion post. Objective parts scored locally, Opus judges the rest → per-skill levels on the 1–6 scale (same as TOEFL iBT bands since Jan 2026), focus areas, realistic outlook |
| 읽기·듣기 (Reading/listening) | Text from a topic, URL or paste, rewritten one step above the learner's level (i+1, ~96–98 % known words) or kept as the original with notes. Lookup modes: off (immersion), tap for meaning, or short Korean meanings shown above the likely-unknown words (one cheap Haiku call per text, cached). Drag a phrase or use the lookup pen for an in-context gloss, add to cards with the sentence. Read-aloud with word highlighting (Edge neural voices), "listen first" mode with the text blurred (its quiz counts as listening evidence), speed control, comprehension quiz, known-word marking on finish, "discuss this text with the AI". Tablet: side panel with looked-up words and a handwritten memo page, focus mode (full screen), pen annotations (see below) |
| AI 대화 (Conversation) | Voice turns: local Whisper large-v3-turbo on the GPU → Sonnet reply pitched at i+1 → TTS. Free talk with tutor memory, 11 role-plays + custom situation, TOEFL "Take an Interview" mode (45 s answers), reading discussion. Silent error log, occasional nudge to self-correct with a retry button, "how do I say this?" helper. End-of-session report (Opus): CAF scores, metrics (wpm, errors and fillers per 100 words, MATTR lexical diversity), top-3 focus, upgraded sentences, expressions to save, memory updates |
| 쓰기 (Writing) | TOEFL 2026 tasks (Write an Email, Academic Discussion) with AI-generated prompts, opinion/journal and free writing; typed or handwritten with the pen (the strokes are sent as a PNG and transcribed by the model). Feedback: level and band, task/organization/language scores, corrections, corrected and C1-level versions, expressions to save; recurring errors join the mistake notebook |
| 계획 (Plan) | **Skill estimate**: a Kalman filter per skill over all evidence (placement, conversation reports, reading and listening quizzes, writing feedback, book scores, mock-test bands entered by hand) with study-time drift between evidence (effective hours per skill × personal learning rate ÷ hours per level step), shown with an 80 % range and a confidence label; the personal rate is calibrated from how the evidence actually moved. **Forecast** to the target date at the current pace and on the plan: level per skill with its range, when C1/C2 would be reached, daily effective minutes needed for the goal. **Study plan** (Opus): 3–5 phases with weekly minutes per block, milestones with skill targets and how to check them, a weekly routine, book schedules, an honest "what is reachable" note. **Tracking**: this week's minutes per block against what should be done by yesterday, past weeks, milestones checked against both forecasts, book progress against schedule, a weekly AI check-in. **Books**: add a book and the model researches it with web search (edition, whether it matches the current TOEFL format, level range, table of contents or an estimated one, recommended weeks/days/minutes for this learner, study method, cautions, sources); accepting it schedules it, adds it to 오늘, and its sessions (minutes, units, scores) count as study time and evidence |
| 노트 (Notes) | Handwritten note pages (grow as you write), book notes, reading memos and reading annotations in one place |
| 단어 (Words) | FSRS scheduling (py-fsrs, 90 % retention, daily new/review caps), word/phrase cards with context and AI-filled meaning, IPA, examples and collocations; correction cards made automatically from recurring mistakes; mistake notebook |
| 기록 (Records) | Current level per skill + TOEFL band estimate, level history, input hours towards 1,000 h, estimated known lemmas towards ~9,500, study calendar, speaking-speed and error-rate trends, 29 badges, monthly AI spend |

### Tablet and pen

Pen input works with any stylus that reports `pointerType: "pen"` (S Pen in Chrome/Samsung Internet, Apple
Pencil, Windows pens): pressure-sensitive strokes (perfect-freehand), the pen's eraser end or barrel button
erases, a pen tap on a word looks it up, finger touches keep scrolling and never draw once a pen has been
seen (palm rejection; scrolling under the pen is blocked by cancelling the touch). Mouse and finger drawing
can be switched on for devices without a pen. On readings, pen strokes are anchored to the nearest word and
highlighter strokes become word highlights, so annotations stay on their words when the tablet is rotated or
the font size changes. Layouts: navigation rail from 600 px, reader side panel from 1024 px, sidebar from
1280 px; tool settings are remembered per device.

All Claude calls go through `backend/app/core/llm.py`, with two interchangeable providers (Settings → AI):

- **Claude subscription (CLI, default when available):** `claude -p` from the Claude Code install, signed in
  with claude.ai, with tools disabled, settings files ignored and `--json-schema` for structured output
  (`backend/app/core/claude_cli.py`). Book research enables only WebSearch/WebFetch; handwritten writing is
  passed as a PNG the model opens with the Read tool from an empty work folder. No per-call charge; it counts against the plan's usage limits. Each call
  starts a process (~1.5 s overhead), so a conversation reply takes about 6–9 s.
- **API key:** `ANTHROPIC_API_KEY` in `backend/.env`; metered per call and stopped at a monthly budget (default $20).

Per-feature model/effort is configurable. Defaults: live conversation on Sonnet 5.5 (low effort), reports,
placement, reading and the study plan on Opus 5.5 (medium), book research, writing feedback and the weekly
check-in on Sonnet 5.5, lookups, card filling and the daily note on Haiku 5.5 (low).
Voice turns are split in two requests (transcribe, then reply) so the learner's words appear at once, and
the reply's audio is synthesized in the background while its text is already shown.

The design choices come from a review of Speak, Duolingo, 말해보카, ELSA, Cake, LingQ, Anki,
Language Reactor, Praktika/Loora, Ringle and TOEFL prep tools, plus second-language-acquisition
research: see [docs/research.md](docs/research.md).

## Layout

```
backend/app/
  core/      llm.py (metered Claude calls), speech.py (Whisper + Edge TTS), store.py (settings, profile, tutor memory)
  learn/     lexicon (frequency ranks, coverage), levels (skill estimate), forecast, plan, books, writing,
             srs (FSRS), placement, reading, talk, mistakes, words, progress
  routers/   HTTP API under /api
frontend/src/
  pages/     TodayPage, placement/, read/, talk/, words/, plan/, write/, notes/, StatsPage, SettingsPage
  components/ink/  InkPad (note pages), useReaderInk (annotations on a reading), InkToolbar
  lib/ink.ts    pen input (pressure, eraser button, palm rejection), stroke geometry, PNG export
  lib/audio.ts  shared playback + MediaRecorder hook
```

## Development

```
cd backend && uv sync && uv run pytest        # fake Claude client, no GPU needed
cd frontend && npm install && npx tsc -b && npx vite build
```

- With the background service running, backend edits restart the server and frontend edits trigger a rebuild
  automatically (check `data/logs/build.log` if a build fails; the previous build stays live).
- `ENGLISHLAB_DATA_DIR` points the app at another data folder (use a copy for experiments);
  `ENGLISHLAB_STT=off` skips loading Whisper.
- The API key lives in `backend/.env` (see `.env.example`); never commit it or `data/`.
- CUDA runtime DLLs come from the `nvidia-cublas-cu12` / `nvidia-cudnn-cu12` wheels; audio is decoded with
  the system `ffmpeg`.

## Planned (phase 2–3)

- Subtitle workspace: YouTube / `.srt` files line by line (auto-pause, replay, slow), subtitles faded out
  in steps, sentence mining with the audio clip
- Shadowing mode with per-word scoring
- Error-to-drill: targeted mini-drills from the mistake notebook
- TOEFL 2026 task simulators (Build a Sentence, Listen and Repeat, Complete the Words …), full mock tests
  with band estimates
- Push reminders

## App window and taskbar

The app window opens at `http://englishlab.localhost:8005`: Edge names an app window's taskbar entry after its host (not the port), so each app has its own host and shows up as its own taskbar icon. The Start menu and Desktop shortcuts carry the same taskbar ID (`MSEdge.englishlab.localhost_/`), so pinning one to the taskbar works. `*.localhost` counts as this PC, like `localhost`.
