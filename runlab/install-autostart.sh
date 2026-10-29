#!/usr/bin/env bash
# Make RunLab behave like an installed program on Linux:
#  - a systemd user service (runlab.service) runs it in the background from log-in
#  - "RunLab" in the app menu opens the app window
# Everything is per-user (~/.config/systemd/user, ~/.local/share/applications). No sudo.
# Undo with ./uninstall-autostart.sh. The same switches are in Settings -> PC app.
set -e
cd "$(dirname "$0")"
[ -x backend/.venv/bin/python ] || ./setup.sh
backend/.venv/bin/python runlab-service.pyw --install
echo "RunLab now runs in the background (runlab.service) and is in the app menu."
echo "  status: systemctl --user status runlab    logs: data/logs/"
echo "Phone (once): tailscale serve --bg 8000"
echo "To keep it reachable while you are logged out: loginctl enable-linger \"$USER\""
