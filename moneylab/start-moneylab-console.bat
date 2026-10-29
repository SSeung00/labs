@echo off
title MoneyLab (console)
cd /d "%~dp0"

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
echo MoneyLab is running at http://localhost:8001
echo Keep this window open. Closing it stops MoneyLab.
echo (Normally you don't need this window: use start-moneylab.bat or the MoneyLab icon.)
echo.

start "" /b cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:8001"

cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --timeout-graceful-shutdown 2
