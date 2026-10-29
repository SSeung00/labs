@echo off
rem Stop the MoneyLab background service (and its server).
cd /d "%~dp0"
"%~dp0backend\.venv\Scripts\pythonw.exe" "%~dp0moneylab-service.pyw" --stop
echo MoneyLab stopped.
timeout /t 2 >nul
