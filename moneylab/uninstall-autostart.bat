@echo off
rem Stop starting MoneyLab at log-in. (Start menu / desktop icons stay; delete them if you like.)
cd /d "%~dp0"
"%~dp0backend\.venv\Scripts\pythonw.exe" "%~dp0moneylab-service.pyw" --uninstall
echo MoneyLab will no longer start at log-in.
pause
