#!/usr/bin/env sh
# Canvass Lead Finder ERP launcher for macOS / Linux.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then echo "Node.js is not installed. Get the LTS version from https://nodejs.org"; exit 1; fi
( sleep 2; (command -v open >/dev/null && open http://localhost:4321) || (command -v xdg-open >/dev/null && xdg-open http://localhost:4321) ) >/dev/null 2>&1 &
NODE_USE_ENV_PROXY=1 exec node server/index.js
