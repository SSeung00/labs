#!/usr/bin/env bash
# Open RoutineLab like a program: starts the background service if it isn't running yet, then opens the
# app window. Same as the RoutineLab launcher in the app menu.
cd "$(dirname "$0")"
[ -x backend/.venv/bin/python ] || ./setup.sh
if [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/routinelab.service" ]; then
  systemctl --user start routinelab.service
fi
setsid -f backend/.venv/bin/python routinelab-service.pyw --open >/dev/null 2>&1
