@echo off
rem Open EnglishLab like a program: starts the background service if it isn't running yet
rem (no console window), then opens the app window. Same as the EnglishLab shortcut.
rem For a visible console with server output, use start-englishlab-console.bat instead.
cd /d "%~dp0"
start "" "%~dp0backend\.venv\Scripts\pythonw.exe" "%~dp0englishlab-service.pyw" --open
