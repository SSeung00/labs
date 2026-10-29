@echo off
rem Open MoneyLab like a program: starts the background service if it isn't running yet
rem (no console window), then opens the app window. Same as the MoneyLab shortcut.
rem For a visible console with server output, use start-moneylab-console.bat instead.
cd /d "%~dp0"
start "" "%~dp0backend\.venv\Scripts\pythonw.exe" "%~dp0moneylab-service.pyw" --open
