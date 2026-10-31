#!/usr/bin/env bash
# Runs Monomyth from source in WSL: the server (server/, on Bun) on :34115, Vite on :9245, and
# an app window (Windows' Edge or Chrome with --app, on its own profile). Closing the window or
# Ctrl+C stops everything.
#
#   ./scripts/dev.sh             # in a window
#   ./scripts/dev.sh --browser   # no window; open http://127.0.0.1:9245 yourself
set -euo pipefail
cd "$(dirname "$0")/.."
url=http://127.0.0.1:9245

for tool in bun curl; do
  command -v "$tool" >/dev/null || { echo "$tool not found on PATH" >&2; exit 1; }
done

[ -d frontend/node_modules ] || (cd frontend && bun install)
[ -d server/node_modules ] || (cd server && bun install)

# Containers need the Go agent (built once, uploaded to the pod); local folders don't.
if [ ! -f agent/bin/agent-linux-amd64 ]; then
  if command -v go >/dev/null; then
    go run ./scripts/buildagent
  else
    echo "note: Go isn't installed, so connecting to containers won't work (local folders will)" >&2
  fi
fi

if curl -s -o /dev/null "$url"; then
  echo "something is already running on $url (an earlier run left behind?); stop it first" >&2
  exit 1
fi

pids=()
# A process and everything under it: bun run starts Vite as a grandchild, which would otherwise be
# left running (and serving) after this script stops.
killtree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do
    killtree "$child"
  done
  kill "$1" 2>/dev/null || true
}
stop() {
  # Also stops shells opened in the app's terminals.
  for pid in "${pids[@]}"; do
    killtree "$pid"
  done
}
trap stop EXIT

bun server/src/main.ts &
pids+=($!)

if [ "${1:-}" = --browser ]; then
  (cd frontend && bun run dev)
  exit
fi

# Windows' browser, so the app gets a regular Windows window instead of WSLg's frame; it reaches
# the servers here through WSL's localhost forwarding.
browser() {
  local c
  for c in "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
    "/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe" \
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"; do
    [ -f "$c" ] && { echo "$c"; return; }
  done
  return 0
}

(cd frontend && exec bun run dev) >/dev/null 2>&1 &
pids+=($!)
until curl -s -o /dev/null "$url"; do
  kill -0 "${pids[1]}" 2>/dev/null || { echo "vite stopped" >&2; exit 1; }
  sleep 0.3
done

bin="$(browser)"
if [ -z "$bin" ]; then
  echo "No Edge or Chrome found; open $url (Ctrl+C to stop)"
  wait
  exit
fi
profile="$(cmd.exe /d /c "echo %LOCALAPPDATA%" 2>/dev/null | tr -d '\r')\\monomyth\\window"
echo "Monomyth is open in its window; close it (or Ctrl+C) to stop."
# Its own profile, so the window is its own process and this waits until it's closed. No
# extensions or sync there, so nothing else takes the app's keys (extensions an organization's
# policy forces on still load).
"$bin" --app="$url" --user-data-dir="$profile" --window-size=1400,900 \
  --no-first-run --no-default-browser-check --disable-extensions --disable-sync >/dev/null 2>&1