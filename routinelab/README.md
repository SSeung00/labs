# RoutineLab

A personal daily-routine app: habits, a traffic-light score for the day, todos and a short evening
reflection. Runs on this PC and is used from the phone (Galaxy Z Fold) over Tailscale as an
installable web app (PWA). Built around the ideas that made "마이루틴" pleasant to use:

- **Traffic light (신호등)** — the day turns green at 60% of its routines (adjustable), not 100%.
- **Modes (루틴 모드)** — routine sets for weekday / weekend / trip; switch for a day or reserve a period.
- **Easy version (대체 습관)** — a lighter alternative for low-energy days that still counts.
- **Breaks (휴가)** — pause the light, streaks and reminders for a date range or a single day.
- **Reflection (회고)** — mood, energy, sleep, weight and a few questions each evening; becomes a journal.
- **Gentle streaks** — skipping a routine ("오늘은 쉬어요") is neutral; one miss is forgiven, two in a row end it.
- Starter templates, badges, confetti when the light turns green, per-routine heatmaps.

## Layout

| Path | What |
| --- | --- |
| `backend/` | FastAPI + SQLModel (SQLite) on `127.0.0.1:8006`; serves the API and `frontend/dist` |
| `backend/app/routine/book.py` | The rules: which routines are due, the day's light, streaks |
| `backend/app/core/scheduler.py` | Push reminders (morning, per-routine, evening review) and daily DB backups |
| `frontend/` | React 19 + Vite + Tailwind 4 PWA; `src/lib/outbox.ts` queues check-ins while the PC is unreachable |
| `routinelab-service.pyw` | Windowless background service: keeps the server up, rebuilds the UI on edits |
| `data/` | Database, VAPID key, backups (not in git) |

## Running

- `install-autostart.bat` — start in the background at Windows log-in, add Start-menu/desktop icons, open the app.
- `start-routinelab.bat` — start the service if needed and open the app window.
- `stop-routinelab.bat` / `uninstall-autostart.bat` — stop it / stop starting at log-in.
- `start-routinelab-console.bat` — run in a visible console instead (for debugging).

### Linux

- `./setup.sh` once (and again after pulling changes): `uv sync`, `npm ci`, web build. Needs [uv](https://docs.astral.sh/uv/) and Node.js 20+.
- `./install-autostart.sh` installs a systemd user service `routinelab.service`, which runs `routinelab-service.pyw` with
  `backend/.venv/bin/python` (the same supervisor as on Windows: keeps uvicorn alive, rebuilds the web app, restarts on
  backend edits), plus an app-menu launcher (`~/.local/share/applications/routinelab.desktop`), and opens the app window
  (a Chromium-family browser in `--app` mode, falling back to the default browser).
- `./start-routinelab.sh` / `./stop-routinelab.sh` / `./uninstall-autostart.sh` mirror the `.bat` files (uninstalling
  keeps the app-menu launcher; delete the `.desktop` file if you like).
- Status: `systemctl --user status routinelab`; logs: `data/logs/`.
- To keep it reachable from the phone while you are logged out: `loginctl enable-linger "$USER"`.
- On Linux, `tailscale serve` needs `sudo tailscale set --operator=$USER` once so it can run without sudo.

Phone: Settings → 휴대폰에서 보기. Set a PIN on the PC, then
`tailscale serve --bg --https=10003 8006` (once) and open `https://<pc>.ts.net:10003` on the phone,
then Chrome menu → Install app. Turn on notifications from Settings → 알림 on the phone.

## Development

```bash
cd backend && uv sync && uv run pytest
cd frontend && npm install && npm run build
```

Ports: app 8006, service control 8096, Vite dev 5179, Tailscale HTTPS 10003.

## App window and taskbar

The app window opens at `http://routinelab.localhost:8006`: Edge names an app window's taskbar entry after its host (not the port), so each app has its own host and shows up as its own taskbar icon. The Start menu and Desktop shortcuts carry the same taskbar ID (`MSEdge.routinelab.localhost_/`), so pinning one to the taskbar works. `*.localhost` counts as this PC, like `localhost`.
