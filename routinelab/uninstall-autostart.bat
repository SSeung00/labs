@echo off
rem Stop starting RoutineLab at log-in. (Start menu / desktop icons stay; delete them if you like.)
cd /d "%~dp0"
"%~dp0backend\.venv\Scripts\pythonw.exe" "%~dp0routinelab-service.pyw" --uninstall
echo RoutineLab will no longer start at log-in.
pause
