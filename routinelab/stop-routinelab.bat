@echo off
rem Stop the RoutineLab background service (and its server).
cd /d "%~dp0"
"%~dp0backend\.venv\Scripts\pythonw.exe" "%~dp0routinelab-service.pyw" --stop
echo RoutineLab stopped.
timeout /t 2 >nul
