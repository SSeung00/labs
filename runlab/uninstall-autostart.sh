#!/usr/bin/env bash
# Stop starting RunLab at log-in. (The app-menu launcher stays; delete
# ~/.local/share/applications/runlab.desktop if you like.)
cd "$(dirname "$0")"
backend/.venv/bin/python runlab-service.pyw --uninstall && echo "RunLab will no longer start at log-in."
