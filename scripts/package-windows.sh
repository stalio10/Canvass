#!/usr/bin/env bash
# Builds Canvass-Windows.zip: a portable Windows package with its own Node.js runtime.
# Nothing to install on the PC — unzip and double-click "Start Canvass.bat".
# Usage: scripts/package-windows.sh [node-version] [output-dir]
set -euo pipefail
NODE_VERSION="${1:-v22.23.5}"
OUT_DIR="${2:-dist}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
PKG="$WORK/Canvass"
mkdir -p "$PKG/app" "$PKG/runtime" "$OUT_DIR"

echo "Downloading Node.js $NODE_VERSION for Windows (x64) and verifying checksum..."
cd "$WORK"
curl -fsS --retry 3 -O "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-win-x64.zip"
curl -fsS --retry 3 -O "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
grep " node-$NODE_VERSION-win-x64.zip\$" SHASUMS256.txt | sha256sum -c -
unzip -q "node-$NODE_VERSION-win-x64.zip"
cp "node-$NODE_VERSION-win-x64/node.exe" "$PKG/runtime/"
cp "node-$NODE_VERSION-win-x64/LICENSE" "$PKG/runtime/NODE-LICENSE.txt"

echo "Copying the app..."
cd "$ROOT"
git ls-files server public legacy samples docs package.json | grep -v '^docs/manual-src/' | while read -r f; do
  mkdir -p "$PKG/app/$(dirname "$f")"; cp "$f" "$PKG/app/$f"
done
cp docs/Canvass-User-Manual.pdf "$PKG/Canvass User Manual.pdf"

crlf() { sed 's/$/\r/'; }

crlf > "$PKG/Start Canvass.bat" <<'EOF'
@echo off
title Canvass Lead Finder
cd /d "%~dp0"
set "CANVASS_DATA_DIR=%~dp0data"
set "PORT=4321"
set "NODE_USE_ENV_PROXY=1"
rem If Canvass is already running, just open it.
curl -s -o nul http://localhost:%PORT%/api/health >nul 2>&1 && (start "" http://localhost:%PORT% & exit /b 0)
echo.
echo   CANVASS Lead Finder is starting...
echo   Your browser will open in a moment.
echo.
echo   Keep this window open while you use Canvass.
echo   Close this window to stop Canvass.
echo.
start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:%PORT%"
"%~dp0runtime\node.exe" "%~dp0app\server\index.js"
echo.
echo   Canvass stopped. If this was unexpected, take a screenshot of the message above.
pause
EOF

crlf > "$PKG/Start Canvass (phones and other PCs).bat" <<'EOF'
@echo off
title Canvass Lead Finder (network)
cd /d "%~dp0"
set "CANVASS_DATA_DIR=%~dp0data"
set "PORT=4321"
set "HOST=0.0.0.0"
set "NODE_USE_ENV_PROXY=1"
echo.
echo   Network mode lets phones, tablets and other PCs on the same Wi-Fi use Canvass.
echo.
set /p CANVASS_PIN=  Choose an access PIN for other devices:
if "%CANVASS_PIN%"=="" (
  echo   A PIN is required in network mode.
  pause
  exit /b 1
)
echo.
echo   This PC's addresses (use the IPv4 one on other devices, followed by :4321):
ipconfig | findstr /i "IPv4"
echo.
echo   Example: http://192.168.1.20:4321
echo   If Windows asks, allow access on Private networks only.
echo.
start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:%PORT%"
"%~dp0runtime\node.exe" "%~dp0app\server\index.js"
pause
EOF

crlf > "$PKG/READ ME FIRST.txt" <<'EOF'
CANVASS Lead Finder  -  Discover. Validate. Analyse. Convert.
=============================================================

START
  Double-click "Start Canvass.bat".
  Your browser opens Canvass. Keep the black window open while you work;
  close it to stop Canvass. Nothing needs to be installed.

FIRST TIME
  1. Open Settings and paste your Google Places API key, then Save.
  2. Fill in "Your company" and "Team members".
  3. Run a small test search (3 leads) in Google Auto Lead Finder.

WINDOWS SAFETY MESSAGE
  The first time, Windows may show "Windows protected your PC".
  Click "More info" then "Run anyway". This appears because the package
  is not code-signed; it only runs the files in this folder.

YOUR DATA
  Everything (API key, settings, leads, backups) is saved in the "data"
  folder next to this file. Keep it private. To move Canvass to another PC,
  copy this whole folder.

UPDATING
  Replace everything EXCEPT the "data" folder.

PHONES / OTHER PCs ON THE SAME WI-FI
  Use "Start Canvass (phones and other PCs).bat" and choose a PIN.

HELP
  See "Canvass User Manual.pdf".
EOF

echo "Zipping..."
cd "$WORK"
rm -f "$ROOT/$OUT_DIR/Canvass-Windows.zip"
zip -qr9 "$ROOT/$OUT_DIR/Canvass-Windows.zip" Canvass
rm -rf "$WORK"
ls -lh "$ROOT/$OUT_DIR/Canvass-Windows.zip"
