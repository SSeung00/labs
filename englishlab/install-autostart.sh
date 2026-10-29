#!/usr/bin/env bash
# Make EnglishLab behave like an installed program on Linux:
#  - a systemd user service (englishlab.service) runs it in the background from log-in
#  - "EnglishLab" in the app menu opens the app window
# Everything is per-user (~/.config/systemd/user, ~/.local/share/applications). No sudo.
# Undo with ./uninstall-autostart.sh. The same switches are in Settings -> PC app.
set -e
cd "$(dirname "$0")"
[ -x backend/.venv/bin/python ] || ./setup.sh
backend/.venv/bin/python englishlab-service.pyw --install
echo "EnglishLab now runs in the background (englishlab.service) and is in the app menu."
echo "  status: systemctl --user status englishlab    logs: data/logs/"
echo "Phone (once): tailscale serve --bg --https=10002 8005"
echo "To keep it reachable while you are logged out: loginctl enable-linger \"$USER\""
