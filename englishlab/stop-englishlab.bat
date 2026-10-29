@echo off
rem Stop the EnglishLab background service (and its server).
cd /d "%~dp0"
"%~dp0backend\.venv\Scripts\pythonw.exe" "%~dp0englishlab-service.pyw" --stop
echo EnglishLab stopped.
timeout /t 2 >nul
