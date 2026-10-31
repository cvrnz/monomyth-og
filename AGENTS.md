# Agent instructions

- Monomyth is the server in `server/` (on Bun) + the frontend in `frontend/`, run two ways:
  the macOS app (`desktop/`, built with Electrobun), and from source in WSL
  (`scripts/dev.sh`: the server, Vite, and Windows' Edge as the window). Use Bun, not Node or
  pnpm. New backend features go in the server (`server/src`), plus the Go agent
  (`internal/agent`) only when they must run inside a container.
- **Hard requirement for the WSL setup (a work machine that doesn't allow unknown
  executables):**
  - A native binary that runs in WSL must be a known developer tool (Bun, Go, git, `oc`,
    ripgrep, and the binaries that come with the npm packages of known tools, like Vite's
    bundler, Tailwind, oxlint and TypeScript).
  - The only programs that run on Windows itself are ones built into Windows: `cmd.exe`,
    `powershell.exe` and Edge, as `scripts/dev.sh` and the folder picker use them. No other
    `.exe`, installer or Windows tooling, from WSL or from code we add.
- Keep the server's native-Windows support (ConPTY terminals through node-pty, PowerShell as
  the shell, `C:/...` paths) even though Windows runs Monomyth from WSL: a native Windows build
  should stay possible. See HANDOFF.md for what it still needs.
- The frontend runs in WebKit (the macOS app) and in Chromium (Edge from WSL): check keys,
  the clipboard and CSS in both.
- `desktop/`:
  - Electrobun 2's SDK comes from its toolchain (Hutch), not npm: `bun run typecheck` there
    runs `electrobun prepare`, which writes it to `.hutch/devkit`.
  - It stays on TypeScript 5.9 (the devkit's tsconfig uses `baseUrl`, which TypeScript 7
    removed).
  - Menu items need their shortcuts spelled out (`accelerator`): Electrobun's roles have none.
  - Closing and quitting go through the page (app → server → page → server → app, see
    `desktop/src/main.ts`), so the page can ask about unsaved changes; keep that path working.
- Checks: `GOOS=linux go vet ./...`, `cd frontend && bun run build && bun run lint`,
  `cd server && bun run typecheck && bun test`, `cd desktop && bun run typecheck`.
