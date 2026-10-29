#!/usr/bin/env bash
# Stop the EnglishLab background service (and its server).
cd "$(dirname "$0")"
backend/.venv/bin/python englishlab-service.pyw --stop && echo "EnglishLab stopped."
