@echo off
title Canvass Lead Finder ERP (network)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and try again.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)
echo.
echo  Network mode lets phones and other PCs on the same Wi-Fi open Canvass.
set /p CANVASS_PIN=Choose an access PIN for other devices: 
if "%CANVASS_PIN%"=="" (
  echo A PIN is required in network mode.
  pause
  exit /b 1
)
set HOST=0.0.0.0
set NODE_USE_ENV_PROXY=1
echo.
echo  On other devices open:  http://THIS-PC-IP:4321   (find the IP with the ipconfig command)
echo  Windows may ask to allow Node.js through the firewall: allow it on Private networks only.
start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:4321"
node server\index.js
pause
