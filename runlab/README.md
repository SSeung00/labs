# RunLab

A personal, local dashboard and training planner for Garmin running data.

- `backend/` — FastAPI + SQLModel (SQLite) + analytics engine (Python 3.12, uv)
- `frontend/` — React + TypeScript + Vite + Tailwind v4 · ECharts · MapLibre
- `data/` — the local database and activity streams (Parquet). Not in git.

## Running

Day to day, just double-click `start-runlab.bat`. If the sources have changed it rebuilds the web app first, then
a single backend serves both the API and the UI at http://localhost:8000.

For development, run two hot-reloading servers separately:

```bash
cd backend && uv sync && uv run uvicorn app.main:app --reload --timeout-graceful-shutdown 2 --port 8000
```

```bash
cd frontend && npm install && npm run dev
```

Then open http://localhost:5173 in the browser. The frontend proxies `/api` to the backend (8000).
The first time, sign in and sync under **Settings (설정) → Garmin Connect (가민 커넥트)**. If the automatic connection
doesn't work, you can also drag and drop a Garmin "Export Your Data" ZIP.

## Running it like a desktop app (Windows)

`runlab-service.pyw` (run with the backend venv's `pythonw.exe`, so no console window) supervises the server:
it keeps uvicorn on `127.0.0.1:8000` alive, rebuilds `frontend/dist` when front-end sources change (after
~15 s of quiet), restarts the server when `backend/app` changes, and takes `stop` / `restart` / `status`
commands on `127.0.0.1:8099` (also its single-instance lock). Logs: `data/logs/service.log`,
`server.log`, `build.log`.

| Script | What it does |
|---|---|
| `install-autostart.bat` | Per-user shortcuts: Start-up (background at log-in), Start menu + Desktop "RunLab" (opens the app window), then starts it |
| `uninstall-autostart.bat` | Removes the Start-up shortcut |
| `start-runlab.bat` | Starts the service if needed and opens the app window (Edge/Chrome `--app` mode) |
| `stop-runlab.bat` | Stops the service and the server |
| `start-runlab-console.bat` | The old way: server in a visible console, for debugging |

The same switches live in Settings → PC app · autostart (PC 앱 · 자동 실행) (local requests only).

The app window opens at `http://runlab.localhost:8000`: Edge names an app window's taskbar entry after its host (not the port), so each app has its own host and shows up as its own taskbar icon. The Start menu and Desktop shortcuts carry the same taskbar ID (`MSEdge.runlab.localhost_/`), so pinning one to the taskbar works. `*.localhost` counts as this PC, like `localhost`.

The service also runs a light Garmin sync once a day (default 08:00, Settings → Sync (동기화) → Daily auto-sync (매일 자동 동기화)).
If the PC was off or asleep at that time it syncs as soon as it's back; a failed run is retried hourly, up to
3 times a day. Only the supervised server schedules it (`RUNLAB_SUPERVISED=1`), so dev and verify servers
pointed at the same database never sync on their own.

Updates reach phones without reinstalling: every build writes `dist/version.json`; the app always loads the
newest build when opened, and an app left open notices a newer build (on resume, or every 10 minutes) — it
reloads itself after being in the background for a minute, or shows a "새로고침" (Refresh) banner otherwise.

### Linux

- `./setup.sh` once (and again after pulling changes): `uv sync`, `npm ci`, web build. Needs [uv](https://docs.astral.sh/uv/) and Node.js 20+.
- `./install-autostart.sh` installs a systemd user service `runlab.service`, which runs `runlab-service.pyw` with
  `backend/.venv/bin/python` (the same supervisor as on Windows: keeps uvicorn alive, rebuilds the web app, restarts on
  backend edits), plus an app-menu launcher (`~/.local/share/applications/runlab.desktop`), and opens the app window
  (a Chromium-family browser in `--app` mode, falling back to the default browser).
- `./start-runlab.sh` / `./stop-runlab.sh` / `./uninstall-autostart.sh` mirror the `.bat` files (uninstalling keeps the
  app-menu launcher; delete the `.desktop` file if you like).
- Status: `systemctl --user status runlab`; logs: `data/logs/`.
- To keep it reachable from the phone while you are logged out: `loginctl enable-linger "$USER"`.
- On Linux, `tailscale serve` needs `sudo tailscale set --operator=$USER` once so it can run without sudo.

## Viewing on the phone (Tailscale)

The backend listens only on `127.0.0.1`; for the phone, [Tailscale](https://tailscale.com/download)'s `serve` forwards it over HTTPS between your own devices only.

1. Set a PIN (4–8 digits) under **Settings → View on phone (휴대폰에서 보기)**. Without a PIN the remote API stays closed.
2. Install Tailscale on the PC and the phone and sign in with the same account.
3. On the PC, run `tailscale serve --bg 8000` once (the first time, allow HTTPS via the link it prints).
4. Open the `https://<pc>.<tailnet>.ts.net` address (QR) shown on the settings card on the phone, enter the PIN → Add to Home screen.

- Only requests from this PC (loopback + localhost Host + no proxy headers) get through without a PIN. Requests through `tailscale serve` need a cookie (180 days); changing the PIN locks every device again. Five wrong attempts block it for 5 minutes.
- The home-screen app (PWA) pre-caches the UI files with a service worker and keeps the last API responses. If the PC is off, it shows the saved screens after 4 seconds and marks this at the top. "잠그기" (Lock) also clears the cached data.
- After editing the UI sources, rebuild with `npm run build` (or `start-runlab.bat`) for the change to show on port 8000.

## Race calendar ↔ training plan

Add upcoming races in the Races menu. There are three priorities:

| Priority | Meaning | When applied to the plan |
|---|---|---|
| A | Goal race | Chosen as the goal of a new plan; the whole plan (taper, peak) is built around this race |
| B | Important race | Easy + strides the day before, hard sessions 2–3 days before → easy, rest the day after (half marathon or longer), hard sessions during recovery (half: 4 days, full: 7 days) → easy |
| C | Training race | Replaces that week's key workout. Only hard sessions within ±2 days become easy |

- For races inside the plan period, use "플랜에 반영" (Apply to plan) on the Races / Training plan screens → preview the changed days, then apply. When creating a new plan, races inside its period are applied automatically.
- If you change a race's date or distance, or delete it, the original race day becomes a rest day, and you can apply it again.
- Past races are linked to a run of similar distance (±15%) on that day as the result.
- The AI coach, plan adjustment and the weekly report also see the race calendar.

## Screens

| Screen | Contents |
|---|---|
| 오늘 (Today) | Weekly distance ring, check-in-based readiness, today's workout, adjustment suggestions, AI coach report |
| 활동 (Activities) | Yearly heatmap, weekly distance, sortable/searchable list |
| 활동 상세 (Activity detail) | Pace-coloured route map ↔ synced charts (pace, heart rate, elevation, cadence, power, GCT…), laps, heart-rate zones, weather, RPE, notes, shoes |
| 컨디션 (Condition) | One-line diagnosis, fitness/fatigue/form traffic lights, fitness/fatigue chart over a status background band (dotted line if you follow the plan), load ramp-rate gauge, easy-training ratio, patterns found in your own data, detailed metrics (CTL/ATL/TSB, zone distribution) |
| 성장 (Progress) | VDOT growth curve (bootstrap range), goal simulator, race predictions, training paces, PR history, aerobic efficiency trend, effect of heat |
| 훈련 계획 (Training plan) | This week's 7-day board (swipe to other weeks), workout detail (target pace and heart rate, actual vs. target, per-rep results), change workout type or date, weekly adjustments (lighter, recovery week), change plan settings to rebuild the coming weeks, full schedule (periodization, calendar, distance vs. plan), send to Garmin calendar |
| 일지 (Journal) | Morning check-in (custom metrics), 60-day trends, injury body map, explore it yourself (ranking of influencing factors, two-metric scatter plot) |
| 장비 (Gear) | Shoe mileage and replacement alerts, assign by date range, efficiency per shoe |
| 설정 (Settings) | Garmin connection and sync, FIT/ZIP import, heart-rate profile (LTHR, zones), CSV export |

## How things are calculated

- **Load**: heart-rate TRIMP normalized so that 1 hour at LTHR = 100 (hrTSS). Without heart rate, RPE × time; without that, a time-based estimate.
- **CTL/ATL/TSB**: 42-day / 7-day exponentially weighted averages, TSB = previous day's CTL − ATL.
- **GAP**: flat-equivalent speed from Minetti (2002) energy cost of gradient.
- **VDOT**: Daniels formula. Per-run heart-rate-based estimate (Swain %HRmax ↔ %VO2max) + estimate from best efforts over segments.
- **Fitness estimate (sequential)**: a 1-D Kalman filter (`analytics/vdot_filter.py`). All-out races weigh heavily, hard segments in training count as "at least this much" evidence, and heart-rate-based estimates weigh little, corrected for a personal bias learned from race results and for temperature. A backtest that predicts past races from the value on the day before is at `/api/progress/backtest`.
- **Post-run update and weekly review**: a daily snapshot (fitness, predictions, goal probability) is kept; the app shows what a single run changed and next week's adjustment proposal (preview → apply).
- **Growth curve**: saturating exponential model fit + residual bootstrap, with predictions anchored to current fitness.
- **Readiness**: assuming the watch isn't worn at night, TSB (40%) + morning check-in (60%) + ACWR and injury adjustments.

## AI features (Claude API, optional)

Put `ANTHROPIC_API_KEY=...` in `backend/.env` and restart RunLab to turn them on. Only summary numbers are sent, never
GPS routes (the 👁 button on each screen shows the data that will be sent). Model and effort per feature are chosen under
Settings → AI usage (AI 사용량) (default: Haiku 5.5 · low for voice logging only, Opus 5.5 · medium for everything else; a coach
conversation keeps the model it started with).

| Feature | Where | What it does | Approx. per call |
|---|---|---|---|
| Run analysis | Activity detail | Lap flow, heart-rate drift, weather, vs. plan, comparison with recent runs of the same type | $0.03–0.06 |
| Voice logging (말로 기록) | Journal | Free-form note → preview of check-in fields and injury log → saved after you confirm | ~$0.015 |
| Adjust with AI (AI로 조정) | Training plan | Describe the situation → proposed changes for the next 3 weeks → apply only the ones you pick | ~$0.05 |
| AI coach | Sidebar | A conversation that answers by looking up your records with read-only tools (run list, detail, weekly/monthly, fitness, condition, plan, shoes) | $0.05–0.20 |
| Weekly report | Today | Summary of the last 7 days and suggestions for next week | ~$0.05 |

- Every call goes through `app/coach/llm.py`, which records tokens and cost in the `aiusage` table. Calls stop once the cumulative cost exceeds the budget (default $20, Settings → AI usage).
- The AI never changes data directly. Journal and plan changes are previewed, then saved/applied by the user.
- Requests refused by policy are retried with the server-side fallback (`server-side-fallback-2026-07-01`).

## Good to know

- Sync runs in a background thread of the backend process. If the server restarts, it **automatically resumes** on the next start.
- Garmin session tokens are stored in `~/.runlab/garmin`; the password is not stored.
- Weather comes from Open-Meteo for the activity's start coordinates (rounded to about 100 m).
- "가민으로 보내기" (Send to Garmin) creates workouts in your Garmin Connect account and schedules them on its calendar (after confirmation).
- On start-up the DB schema adds new columns automatically (nullable columns only).

## Tests

```bash
cd backend && uv run pytest
```

```bash
cd frontend && npx tsc -b && npx oxlint
```
