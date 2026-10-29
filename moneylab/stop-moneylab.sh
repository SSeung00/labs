#!/usr/bin/env bash
# Stop the MoneyLab background service (and its server).
cd "$(dirname "$0")"
backend/.venv/bin/python moneylab-service.pyw --stop && echo "MoneyLab stopped."
