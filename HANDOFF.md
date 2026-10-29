# Handoff notes

A standalone desktop editor (Wails + Vite + React + TypeScript + HeroUI + pnpm) that runs on
macOS/Windows and edits files inside a remote OpenShift/Dev Spaces container. It talks to a small
Go agent that it uploads and starts in the container with `oc exec`. The behavior copies the Neovim
config in `dev/configs/nvim`: keymaps, tabline, statusline, command palette, floating explorer,
source control tab, the centered-content rule and themes.

User choices: connect with `oc exec` (pick project/pod/container); features are the file explorer,
tabs + Monaco with save, terminals (xterm.js), a source control tab, a command palette, the
centered-content rule and Vim keybindings; targets are macOS and Windows; **use Wails v3**
(v3.0.0 is stable, released 2026-10-26).

## Done

- **Agent** (`agent/`, linux only): newline-delimited JSON RPC over stdin/stdout. It handles
  `hello`, `fs.*` (list/read/write atomically/create/rename/delete/stat), `term.*` (pty login shell
  via creack/pty, base64 output in `term.data` events) and `scm.*` (repos/changes/versions/fetch/
  sync, ported from the VS Code source-control extension). Built and smoke-tested locally.
- **Protocol** (`internal/proto`), **remote** (`internal/remote`): RPC client, finding `oc`
  (Homebrew/Windows paths), project/pod listing, and Connect. Connect probes the container's
  arch/cache, uploads the embedded agent with `cat >` if its hash is missing, then execs it.
  Hidden console window on Windows.
- `scripts/buildagent`: builds `agent-linux-{amd64,arm64}` into `internal/remote/agentbin/`.
  These are generated files and are not committed.
- **App service** (`internal/app/app.go`): Settings/SaveSettings, Platform, OcProjects, OcPods,
  Connect/Disconnect, Call(method, paramsJSON), SetDirty, BeforeClose, Quit, Shutdown. Events:
  `agent:status`, `agent:event`, `agent:closed`, `app:quit-requested`. Wire `Emit`/`QuitFn` from
  main.
- `cmd/devserver`: HTTP `POST /api/<Method>` plus SSE `/api/events` on :34115. Use it to work on
  the UI in a browser with a local agent (no Wails or oc login needed).
- **Frontend foundations** (`frontend/src/lib`): bridge, agent, paths, themes (8 dark palettes),
  store, monaco (workers, themes, language map) and dialogs. Dependencies are installed with pnpm.
- **VS Code extension** (separate earlier task): `dev/configs/vscode-source-control`.

## In progress: migrate Wails v2 → v3

The project was scaffolded with v2. Current state of the migration:

- `wails3` v3.0.0 is installed on the old machine. On Linux, build it with
  `CGO_ENABLED=0 go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0`.
- **v3 requires Go ≥ 1.26.** Use `GOTOOLCHAIN=go1.26.0+auto` or install Go 1.26.
- In v3.0.0 the React+TS template is called `react` (`wails3 init -n x -t react`).
- `main.go`, `go.mod`, `wails.json` and `build/` are **still v2**.

### Plan

1. `go get github.com/wailsapp/wails/v3@v3.0.0`, remove v2, set `go 1.26.0`, `go mod tidy`.
2. Copy `Taskfile.yml` and `build/` (config.yml, darwin, windows, Taskfile.yml) from a fresh
   `wails3 init -t react` scaffold. Set `PACKAGE_MANAGER: pnpm`, the product name/identifier
   (Editor / com.carlos.editor) and the dev port. Delete `wails.json`.
3. Rewrite `main.go` for v3:
   - `application.New(Options{Services: [NewService(a)], Assets: AssetFileServerFS(assets)})`.
   - Set `Mac.ApplicationShouldTerminateAfterLastWindowClosed`.
   - On darwin, add a menu with `AppMenu` + `EditMenu` roles.
   - `win := app.Window.NewWithOptions(...)`, sized 1400×900 with a 640×400 minimum and the dark
     background color.
   - `win.RegisterHook(events.Common.WindowClosing, func(e){ if a.BeforeClose() { e.Cancel() } })`.
   - `a.Emit = func(n, d){ app.Event.Emit(n, d) }` and `a.QuitFn = app.Quit`.
   - Replace `Shutdown` with `ServiceShutdown()` (or `OnShutdown`).
4. Frontend: `pnpm add @wailsio/runtime@3.0.0` and add `wails("./bindings")` from
   `@wailsio/runtime/plugins/vite` to `vite.config.ts` (keep the `/api` proxy). In
   `src/lib/bridge.ts`, detect Wails and use `Call.ByName("editor/internal/app.App.<Method>", ...)`
   (or the generated bindings) and `Events.On(name, ev => fn(ev.data))`. Fall back to the
   devserver otherwise.
5. Write the UI: `index.css` (tailwind + `@heroui/styles` + xterm css), `main.tsx`, and `App.tsx`
   (settings, connect screen vs workspace, global Cmd/Ctrl keymaps, quit confirmation). Then the
   components: ConnectScreen, TabBar, StatusBar, EditorTab (Monaco + monaco-vim + `:w`, dirty
   state, centered at maxColumns=120), TerminalTab (xterm + webgl + fit), ScmTab (Repos/Changes
   list + Monaco DiffEditor + sync), Explorer (floating 80% box, tree + preview),
   CommandPalette (fuzzy, Tab completes, Themes with live preview) and Welcome.
   HeroUI v3 uses the compound API: `Modal.Backdrop/Container/Dialog`, `Select.Trigger/Popover`,
   and so on.
6. Verify:
   - `go run ./scripts/buildagent`, `pnpm build`, `tsc`, `oxlint`, `go vet ./...`.
   - Browser test: `go build -o /tmp/editor-agent ./agent` plus `go run ./cmd/devserver`, then
     `pnpm dev`, and take Playwright screenshots.
   - Build the real app with `wails3 build` on macOS/Windows; the container has no
     GTK4/WebKitGTK.
7. Replace `README.md`, which is still the v2 template text, with real build/dev/`oc login`
   instructions.

Shortcut reference (Cmd on Mac, Ctrl elsewhere):

| Shortcut | Action |
|----------|--------|
| W | close |
| S | save |
| N | new tab |
| P | search files |
| G | source control |
| E | explorer |
| T | terminal tab |
| \ | split terminal |
| H / L | previous / next tab |

`:` opens the command palette. See `nvim/init.lua` and `lua/*.lua` for details.
