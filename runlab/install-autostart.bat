@echo off
rem Make RunLab behave like an installed program:
rem  - starts in the background (no window) whenever you log in to Windows
rem  - "RunLab" in the Start menu and on the desktop opens the app window
rem Everything is per-user (your Start-up folder, Start menu, Desktop). No admin rights.
rem Undo with uninstall-autostart.bat. The same switches are in Settings -> PC app.
cd /d "%~dp0"
start "" "%~dp0backend\.venv\Scripts\pythonw.exe" "%~dp0runlab-service.pyw" --install
echo RunLab now starts in the background when you log in, and is opening now.
echo Next time, open it from the Start menu or the "RunLab" icon on the desktop.
echo.
echo Tip: so the phone can reach it, keep the PC from sleeping while plugged in
echo   (Windows Settings ^> System ^> Power ^> Sleep: Never when plugged in).
pause
