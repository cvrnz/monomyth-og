#!/usr/bin/env bash
# Runs Monomyth in a browser, with no exe (Git Bash on Windows, macOS, Linux): the Node server
# (server/) on :34115 and Vite on http://127.0.0.1:9245. Ctrl+C stops both.
#
#   ./scripts/dev.sh
set -euo pipefail
cd "$(dirname "$0")/.."

for tool in node pnpm; do
  command -v "$tool" >/dev/null || { echo "$tool not found on PATH" >&2; exit 1; }
done

[ -d frontend/node_modules ] || pnpm --dir frontend install
[ -d server/node_modules ] || pnpm --dir server install

# Containers need the Go agent (built once, uploaded to the pod); local folders don't.
if [ ! -f internal/remote/agentbin/agent-linux-amd64 ]; then
  if command -v go >/dev/null; then
    go run ./scripts/buildagent
  else
    echo "note: Go isn't installed, so connecting to containers won't work (local folders will)" >&2
  fi
fi

node server/src/main.ts &
server=$!
stop() {
  # Also stops shells opened in the app's terminals.
  if [ -r "/proc/$server/winpid" ]; then
    taskkill //PID "$(cat "/proc/$server/winpid")" //T //F >/dev/null 2>&1 || true
  else
    kill "$server" 2>/dev/null || true
  fi
}
trap stop EXIT

pnpm --dir frontend dev