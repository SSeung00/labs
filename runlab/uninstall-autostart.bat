@echo off
rem Stop starting RunLab at log-in. (Start menu / desktop icons stay; delete them if you like.)
cd /d "%~dp0"
"%~dp0backend\.venv\Scripts\pythonw.exe" "%~dp0runlab-service.pyw" --uninstall
echo RunLab will no longer start at log-in.
pause
