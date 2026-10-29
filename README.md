# Labs

Small self-hosted apps I build for my own life, each one a FastAPI backend serving a React (Vite + Tailwind)
web app from `127.0.0.1`. They run quietly in the background on my PC and reach my phone through
[Tailscale](https://tailscale.com) (`tailscale serve`, PIN-locked), installed there as PWAs. Their UI is in Korean.

| App | What it is | Port |
|---|---|---|
| [runlab](runlab/) | Running dashboard and training planner for Garmin data | 8000 |
| [moneylab](moneylab/) | Budget, assets, events, loans and card statements | 8001 |
| [hwplab](hwplab/) | HWP/HWPX document editor written from the public format specs | 8004 |
| [englishlab](englishlab/) | AI English tutor: talk, reading, writing, spaced-repetition cards (Whisper STT, Edge TTS) | 8005 |
| [routinelab](routinelab/) | Daily routines, todos and reflections with streaks and reminders | 8006 |
| [boardgames](boardgames/) | Board games to play with friends on the phone (static site, PeerJS) — [play](https://sseung00.github.io/boardgames/) | — |

Related repositories: **creativelab** (PhotoLab, a raw photo editor, and future creative tools) and a private
research-automation app.

Nothing personal is in this repository: each app keeps its database, keys and caches in its own `data/`
folder, which is git-ignored.

## Requirements

- Python 3.12 with [uv](https://docs.astral.sh/uv/), Node.js 20+
- Optional: an NVIDIA GPU (EnglishLab speech recognition), the `claude` CLI (AI features), Tailscale (phone access)

## Run on Windows

Each app has `install-autostart.bat` (background service at log-in + Start-menu/Desktop shortcuts),
`start-<app>.bat`, `stop-<app>.bat` and `uninstall-autostart.bat`. See each app's README.

## Run on Linux

```bash
scripts/linux-setup.sh                   # all apps: uv sync, npm ci, build, systemd user service, app launcher
scripts/linux-setup.sh runlab moneylab   # or only some
```

Per app, the same is `./setup.sh` then `./install-autostart.sh`; `./start-<app>.sh`, `./stop-<app>.sh` and
`./uninstall-autostart.sh` mirror the Windows scripts. The background service is a systemd **user** unit
(`systemctl --user status runlab`), logs are in `<app>/data/logs/`. HwpLab has no service: `./start-hwplab.sh`.

- Phone access: `sudo tailscale set --operator=$USER` once, then the `tailscale serve` command from the app's
  README (for example `tailscale serve --bg 8000` for RunLab).
- Keep the services running while logged out: `loginctl enable-linger "$USER"`.
- Moving from Windows: mount the Windows drive read-only and run
  `scripts/import-windows-data.sh /path/to/Windows/Users/<name>/projects` to copy every app's `data/`.

## Layout

Every app follows the same shape:

```
<app>/
  backend/            FastAPI + SQLModel, uv project (app/, tests/)
  frontend/           React + TypeScript + Vite + Tailwind
  <app>-service.pyw   supervisor: keeps uvicorn alive, rebuilds the web app on edits, restarts on backend edits
  *.bat / *.sh        Windows / Linux launch scripts
  data/               local database and files (not in git)
```
