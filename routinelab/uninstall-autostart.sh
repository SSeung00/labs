#!/usr/bin/env bash
# Stop starting RoutineLab at log-in. (The app-menu launcher stays; delete
# ~/.local/share/applications/routinelab.desktop if you like.)
cd "$(dirname "$0")"
backend/.venv/bin/python routinelab-service.pyw --uninstall && echo "RoutineLab will no longer start at log-in."
