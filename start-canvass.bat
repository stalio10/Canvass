@echo off
title Canvass Lead Finder ERP
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed on this PC.
  echo  Opening the download page. Install the LTS version, then run this file again.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)
echo.
echo  Starting Canvass... your browser will open in a moment.
echo  Keep this window open while you use Canvass. Close it to stop.
start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:4321"
set NODE_USE_ENV_PROXY=1
node server\index.js
pause
