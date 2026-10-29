#!/usr/bin/env bash
# Stop starting MoneyLab at log-in. (The app-menu launcher stays; delete
# ~/.local/share/applications/moneylab.desktop if you like.)
cd "$(dirname "$0")"
backend/.venv/bin/python moneylab-service.pyw --uninstall && echo "MoneyLab will no longer start at log-in."
