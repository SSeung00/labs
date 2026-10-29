@echo off
title HwpLab
cd /d "%~dp0"

rem Opens as its own window. Edge names the taskbar entry after the host (not the port), so each app
rem uses its own *.localhost host to get its own taskbar icon.
set APP_URL=http://hwplab.localhost:8004/

rem Already running? Just open it.
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8004 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  start msedge --app=%APP_URL%
  exit /b 0
)

rem First run: create the Python environment.
if not exist backend\.venv\Scripts\python.exe (
  echo Setting up Python packages ^(first run only^)...
  pushd backend
  uv sync
  popd
)

rem Rebuild the web app only when a source file is newer than the last build.
powershell -NoProfile -Command "$d='frontend\dist\index.html'; if(!(Test-Path $d)){exit 1}; $t=(Get-Item $d).LastWriteTime; if(Get-ChildItem frontend\src,frontend\public,frontend\index.html -Recurse -File | Where-Object {$_.LastWriteTime -gt $t} | Select-Object -First 1){exit 1}; exit 0"
if errorlevel 1 (
  echo Building the web app ^(first run or after an update^)...
  pushd frontend
  if not exist node_modules call npm install
  call npm run build
  popd
)

echo.
echo HwpLab is running at http://127.0.0.1:8004
echo Keep this window open. Closing it stops HwpLab.
echo.

start "" /b cmd /c "timeout /t 3 /nobreak >nul & start msedge --app=%APP_URL%"

cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8004 --timeout-graceful-shutdown 2
