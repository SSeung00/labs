#!/usr/bin/env bash
# Stop starting EnglishLab at log-in. (The app-menu launcher stays; delete
# ~/.local/share/applications/englishlab.desktop if you like.)
cd "$(dirname "$0")"
backend/.venv/bin/python englishlab-service.pyw --uninstall && echo "EnglishLab will no longer start at log-in."
