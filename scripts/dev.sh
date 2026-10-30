#!/usr/bin/env bash
# Runs Monomyth with no exe of its own (Git Bash on Windows, WSL, macOS, Linux): the Node server
# (server/) on :34115, Vite on :9245, and an app window (Edge or Chrome with --app, on its own
# profile; the Windows browser under WSL). Closing the window or Ctrl+C stops everything.
#
#   ./scripts/dev.sh             # in a window
#   ./scripts/dev.sh --browser   # no window; open http://127.0.0.1:9245 yourself
set -euo pipefail
cd "$(dirname "$0")/.."
url=http://127.0.0.1:9245

for tool in node pnpm curl; do
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

pids=()
stop() {
  # Also stops shells opened in the app's terminals.
  for pid in "${pids[@]}"; do
    if [ -r "/proc/$pid/winpid" ]; then
      taskkill //PID "$(cat "/proc/$pid/winpid")" //T //F >/dev/null 2>&1 || true
    else
      pkill -P "$pid" 2>/dev/null || true
      kill "$pid" 2>/dev/null || true
    fi
  done
}
trap stop EXIT

node server/src/main.ts &
pids+=($!)

if [ "${1:-}" = --browser ]; then
  pnpm --dir frontend dev
  exit
fi

wsl=
grep -qi microsoft /proc/version 2>/dev/null && wsl=1

browser() {
  local c
  if [ -n "${LOCALAPPDATA:-}" ] && command -v cygpath >/dev/null; then
    local pf
    pf="$(cygpath -u "${PROGRAMFILES:-C:\\Program Files}")"
    for c in "$pf (x86)/Microsoft/Edge/Application/msedge.exe" \
      "$pf/Microsoft/Edge/Application/msedge.exe" \
      "$pf/Google/Chrome/Application/chrome.exe" \
      "$(cygpath -u "$LOCALAPPDATA")/Google/Chrome/Application/chrome.exe"; do
      [ -f "$c" ] && { echo "$c"; return; }
    done
  fi
  # Under WSL, use the Windows browser so the app gets a regular Windows window instead of
  # WSLg's frame; it reaches the servers here through WSL's localhost forwarding
  if [ -n "$wsl" ]; then
    for c in "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
      "/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe" \
      "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"; do
      [ -f "$c" ] && { echo "$c"; return; }
    done
  fi
  for c in "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    [ -x "$c" ] && { echo "$c"; return; }
  done
  for c in microsoft-edge google-chrome chromium chromium-browser; do
    command -v "$c" >/dev/null && { command -v "$c"; return; }
  done
}

pnpm --dir frontend dev >/dev/null 2>&1 &
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
if [ -n "${LOCALAPPDATA:-}" ] && command -v cygpath >/dev/null; then
  profile="$(cygpath -w "$LOCALAPPDATA")\\monomyth\\window"
elif [ -n "$wsl" ]; then
  profile="$(cmd.exe /d /c "echo %LOCALAPPDATA%" 2>/dev/null | tr -d '\r')\\monomyth\\window"
else
  profile="${XDG_CONFIG_HOME:-$HOME/.config}/monomyth/window"
fi
echo "Monomyth is open in its window; close it (or Ctrl+C) to stop."
# Its own profile, so the window is its own process and this waits until it's closed. No
# extensions or sync there, so nothing else takes the app's keys (extensions an organization's
# policy forces on still load).
"$bin" --app="$url" --user-data-dir="$profile" --window-size=1400,900 \
  --no-first-run --no-default-browser-check --disable-extensions --disable-sync >/dev/null 2>&1