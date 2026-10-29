#!/usr/bin/env bash
# Make RoutineLab behave like an installed program on Linux:
#  - a systemd user service (routinelab.service) runs it in the background from log-in
#  - "RoutineLab" in the app menu opens the app window
# Everything is per-user (~/.config/systemd/user, ~/.local/share/applications). No sudo.
# Undo with ./uninstall-autostart.sh. The same switches are in Settings -> PC app.
set -e
cd "$(dirname "$0")"
[ -x backend/.venv/bin/python ] || ./setup.sh
backend/.venv/bin/python routinelab-service.pyw --install
echo "RoutineLab now runs in the background (routinelab.service) and is in the app menu."
echo "  status: systemctl --user status routinelab    logs: data/logs/"
echo "Phone (once): tailscale serve --bg --https=10003 8006"
echo "To keep it reachable while you are logged out: loginctl enable-linger \"$USER\""
