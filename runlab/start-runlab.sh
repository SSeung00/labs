#!/usr/bin/env bash
# Open RunLab like a program: starts the background service if it isn't running yet, then opens the
# app window. Same as the RunLab launcher in the app menu.
cd "$(dirname "$0")"
[ -x backend/.venv/bin/python ] || ./setup.sh
if [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/runlab.service" ]; then
  systemctl --user start runlab.service
fi
setsid -f backend/.venv/bin/python runlab-service.pyw --open >/dev/null 2>&1
