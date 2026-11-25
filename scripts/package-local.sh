#!/usr/bin/env bash
# Builds Canvass-Local.zip: the full Canvass app (Pitch HQ + Lead Finder) to try on your own computer.
# Windows: PHP is included — unzip and double-click "Start Canvass.bat". Mac/Linux: needs PHP 8.2+ installed.
# Usage: scripts/package-local.sh [php-version] [output-dir]
set -euo pipefail
PHP_VERSION="${1:-8.2.36}"
OUT_DIR="${2:-dist}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
PKG="$WORK/Canvass"
mkdir -p "$PKG/app" "$PKG/php" "$ROOT/$OUT_DIR"
PHPZIP="php-$PHP_VERSION-nts-Win32-vs16-x64.zip"

echo "Downloading PHP $PHP_VERSION for Windows (x64) and verifying its checksum..."
cd "$WORK"
curl -fsSL --retry 3 -o "$PHPZIP" "https://downloads.php.net/~windows/releases/$PHPZIP" || curl -fsSL --retry 3 -o "$PHPZIP" "https://downloads.php.net/~windows/releases/archives/$PHPZIP"
curl -fsSL --retry 3 -o sha256sum.txt "https://downloads.php.net/~windows/releases/sha256sum.txt"
SUM="$(grep -i "$PHPZIP" sha256sum.txt | grep -oiE '[0-9a-f]{64}' | head -1)"
[ -n "$SUM" ] && echo "$SUM  $PHPZIP" | sha256sum -c -
unzip -q "$PHPZIP" -d "$PKG/php"
rm -rf "$PKG/php/dev" "$PKG/php/extras" "$PKG/php/lib"
echo "Downloading the certificate list PHP uses for secure (https) connections..."
curl -fsSL --retry 3 -o "$PKG/php/cacert.pem" https://curl.se/ca/cacert.pem
curl -fsSL --retry 3 -o cacert.pem.sha256 https://curl.se/ca/cacert.pem.sha256
(cd "$PKG/php" && sha256sum -c "$WORK/cacert.pem.sha256")

crlf() { sed 's/$/\r/'; }
crlf > "$PKG/php/php.ini" <<'EOF'
; Canvass local test settings (the start script adds the folder-specific paths)
extension=curl
extension=openssl
extension=mbstring
extension=fileinfo
extension=pdo_sqlite
extension=sqlite3
date.timezone = UTC
memory_limit = 256M
max_execution_time = 300
upload_max_filesize = 26M
post_max_size = 28M
display_errors = Off
log_errors = On
EOF

echo "Copying the app..."
cd "$ROOT"
git ls-files canvass | grep -v '^canvass/tests/' | while read -r f; do rel="${f#canvass/}"; mkdir -p "$PKG/app/$(dirname "$rel")"; cp "$f" "$PKG/app/$rel"; done
[ -f docs/Canvass-User-Manual.pdf ] && cp docs/Canvass-User-Manual.pdf "$PKG/Canvass User Manual.pdf"

crlf > "$PKG/Start Canvass.bat" <<'EOF'
@echo off
title Canvass
cd /d "%~dp0"
set "PORT=4400"
set "CANVASS_DATA_DIR=%~dp0data"
set "PHPEXE=%~dp0php\php.exe"
set PHPARGS=-c "%~dp0php\php.ini" -d extension_dir="%~dp0php\ext" -d curl.cainfo="%~dp0php\cacert.pem" -d openssl.cafile="%~dp0php\cacert.pem"
rem Already running? Just open it.
curl -s -o nul http://localhost:%PORT%/api.php?a=me >nul 2>&1 && (start "" http://localhost:%PORT% & exit /b 0)
"%PHPEXE%" %PHPARGS% -r "exit(extension_loaded('pdo_sqlite') && extension_loaded('curl') ? 0 : 1);" >nul 2>&1
if errorlevel 1 (
  echo.
  echo   PHP could not start on this PC.
  echo   Usually this means a free Microsoft component is missing.
  echo   Install "Microsoft Visual C++ Redistributable (x64)" from:
  echo   https://aka.ms/vs/17/release/vc_redist.x64.exe
  echo   then double-click Start Canvass.bat again.
  echo.
  pause
  exit /b 1
)
echo.
echo   CANVASS is starting...
echo   Your browser opens in a moment:  http://localhost:%PORT%
echo.
echo   First sign-in:  username MSB   password admin
echo   (change it in My space after you sign in)
echo.
echo   Keep this window open while you use Canvass. Close it to stop Canvass.
echo.
start "Canvass background worker" /min "%PHPEXE%" %PHPARGS% "%~dp0app\cron.php" --loop --watch=127.0.0.1:%PORT%
start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:%PORT%"
"%PHPEXE%" %PHPARGS% -S 127.0.0.1:%PORT% -t "%~dp0app" "%~dp0app\router.php"
echo.
echo   Canvass stopped. If this was unexpected, take a screenshot of the message above.
pause
EOF

cat > "$PKG/start-canvass.sh" <<'EOF'
#!/usr/bin/env bash
# Mac / Linux: needs PHP 8.2 or newer (Mac: install Homebrew, then run "brew install php").
cd "$(dirname "$0")"
PORT=4400
export CANVASS_DATA_DIR="$PWD/data"
command -v php >/dev/null || { echo "PHP is not installed. On a Mac run: brew install php"; exit 1; }
php -r 'exit(version_compare(PHP_VERSION,"8.2","<") || !extension_loaded("pdo_sqlite") || !extension_loaded("curl") ? 1 : 0);' || { echo "Canvass needs PHP 8.2+ with the pdo_sqlite and curl extensions."; exit 1; }
echo; echo "  CANVASS is running at http://localhost:$PORT"
echo "  First sign-in: username MSB, password admin (change it in My space)."
echo "  Press Ctrl+C to stop."; echo
php app/cron.php --loop --watch=127.0.0.1:$PORT >/dev/null 2>&1 &
WORKER=$!
trap 'kill $WORKER 2>/dev/null' EXIT
( sleep 2; (command -v open >/dev/null && open "http://localhost:$PORT") || (command -v xdg-open >/dev/null && xdg-open "http://localhost:$PORT") ) >/dev/null 2>&1 &
php -d max_execution_time=300 -d upload_max_filesize=26M -d post_max_size=28M -S 127.0.0.1:$PORT -t app app/router.php
EOF
chmod +x "$PKG/start-canvass.sh"
cp "$PKG/start-canvass.sh" "$PKG/Start Canvass (Mac).command"; chmod +x "$PKG/Start Canvass (Mac).command"

crlf > "$PKG/READ ME FIRST.txt" <<'EOF'
CANVASS  -  Pitch HQ + Lead Finder in one app (test version for your computer)
==============================================================================

START (Windows)
  Double-click "Start Canvass.bat". Your browser opens Canvass.
  Keep the black window open while you work. Close it to stop Canvass.
  A second, minimised window called "Canvass background worker" runs
  Lead Finder searches. It closes by itself when Canvass stops.

START (Mac)
  Needs PHP: install Homebrew (brew.sh), then run "brew install php".
  Then double-click "Start Canvass (Mac).command".

FIRST SIGN-IN
  Username: MSB     Password: admin
  The team accounts from Pitch HQ are created too (Ismail, Amal, Tins,
  password 0000). Change passwords in My space, and in Team as the admin.

FIRST TIME IN LEAD FINDER
  1. Lead Finder > Settings: paste your Google Places API key, then Save.
  2. Lead Finder > Find on Google: try a small search (3 leads).
  3. Qualified leads appear in Pipeline under "Spotted".
  Moving from the Windows version (v1.0)? In the old app use
  Reports and Backup > Download backup. Then here use
  Lead Finder > Reports & backup > Restore from file.

WINDOWS SAFETY MESSAGE
  Windows may show "Windows protected your PC". Click "More info", then
  "Run anyway". If Windows Firewall asks about php.exe, you can click Cancel:
  Canvass only listens on this computer.

YOUR DATA
  Everything you add is saved in the "data" folder next to this file.
  This is a test copy: it does not touch your live Pitch HQ site.
EOF

echo "Zipping..."
cd "$WORK"
rm -f "$ROOT/$OUT_DIR/Canvass-Local.zip"
zip -qr9 "$ROOT/$OUT_DIR/Canvass-Local.zip" Canvass
rm -rf "$WORK"
ls -lh "$ROOT/$OUT_DIR/Canvass-Local.zip"
