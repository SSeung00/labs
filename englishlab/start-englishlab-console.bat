@echo off
title EnglishLab (console)
cd /d "%~dp0"

rem Rebuild the web app only when a source file is newer than the last build.
powershell -NoProfile -Command "$d='frontend\dist\index.html'; if(!(Test-Path $d)){exit 1}; $t=(Get-Item $d).LastWriteTime; if(Get-ChildItem frontend\src,frontend\public,frontend\index.html -Recurse -File | Where-Object {$_.LastWriteTime -gt $t} | Select-Object -First 1){exit 1}; exit 0"
if errorlevel 1 (
  echo Building the web app ^(first run or after an update^)...
  pushd frontend
  call npm run build
  popd
)

echo.
echo EnglishLab is running at http://localhost:8005
echo Phone: open the Tailscale address shown in EnglishLab Settings.
echo Keep this window open. Closing it stops EnglishLab.
echo.

rem Open the browser once the server has had a moment to start.
start "" /b cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:8005"

cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8005 --timeout-graceful-shutdown 2
