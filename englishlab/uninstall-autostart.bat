@echo off
rem Stop starting EnglishLab at log-in. (Start menu / desktop icons stay; delete them if you like.)
cd /d "%~dp0"
"%~dp0backend\.venv\Scripts\pythonw.exe" "%~dp0englishlab-service.pyw" --uninstall
echo EnglishLab will no longer start at log-in.
pause
