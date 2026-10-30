# Agent instructions

- Monomyth runs as the Node server in `server/` + Vite + the frontend (`scripts/dev.sh`).
  New backend features go in the Node server (`server/src`), plus the Go agent
  (`internal/agent`) only when they must run inside a container.
- **Hard requirement: never run `.exe` files on the host (Windows) machine**, from WSL or
  from code we add, except programs built into Windows (`cmd.exe`, `powershell.exe`, Edge,
  as `scripts/dev.sh` and the folder picker already use). No other Windows binaries,
  installers or native Windows tooling: choose dependencies that are pure JS/TS or run inside
  WSL/Linux.
