#!/bin/bash
# Runs the two-browser /send proof against a throwaway local server (127.0.0.1 only, own sqlite file).
# From the repo root, with Go, node and a Chromium (CHROME=/path/to/chrome) available:
#   CHROME=... bash tools/send-e2e.sh [--size 100] [--only transfer,corrupt] [--log run.log]
# playwright-core is installed into a scratch folder, not into the repo.
set -e
cd "$(dirname "$0")/.."
PORT=${PORT:-18300}
RUN=$(mktemp -d)
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run build >/dev/null   # always: the test must run against the current source
go build -o "$RUN/filehop" ./cmd/filehop
FILEHOP_ADDR=127.0.0.1:$PORT FILEHOP_DB="$RUN/e2e.db" FILEHOP_BASE_URL=http://127.0.0.1:$PORT FILEHOP_TRUST_PROXY=1 \
  "$RUN/filehop" > "$RUN/server.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null; rm -rf "$RUN"' EXIT
mkdir -p "$RUN/pw" && (cd "$RUN/pw" && npm init -y >/dev/null && npm i playwright-core --no-audit --no-fund >/dev/null)
sleep 1
PW_DIR="$RUN/pw" node tools/send-e2e.mjs --base "http://127.0.0.1:$PORT" "$@"
