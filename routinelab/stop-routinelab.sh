#!/usr/bin/env bash
# Stop the RoutineLab background service (and its server).
cd "$(dirname "$0")"
backend/.venv/bin/python routinelab-service.pyw --stop && echo "RoutineLab stopped."
