#!/usr/bin/env bash
# Make MoneyLab behave like an installed program on Linux:
#  - a systemd user service (moneylab.service) runs it in the background from log-in
#  - "MoneyLab" in the app menu opens the app window
# Everything is per-user (~/.config/systemd/user, ~/.local/share/applications). No sudo.
# Undo with ./uninstall-autostart.sh. The same switches are in Settings -> PC app.
set -e
cd "$(dirname "$0")"
[ -x backend/.venv/bin/python ] || ./setup.sh
backend/.venv/bin/python moneylab-service.pyw --install
echo "MoneyLab now runs in the background (moneylab.service) and is in the app menu."
echo "  status: systemctl --user status moneylab    logs: data/logs/"
echo "Phone (once): tailscale serve --bg --https=8443 8001"
echo "To keep it reachable while you are logged out: loginctl enable-linger \"$USER\""
