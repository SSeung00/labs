#!/usr/bin/env bash
# Stop the RunLab background service (and its server).
cd "$(dirname "$0")"
backend/.venv/bin/python runlab-service.pyw --stop && echo "RunLab stopped."
