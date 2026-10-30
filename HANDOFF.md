# Handoff notes

Monomyth: a standalone desktop editor (Wails v3 + Vite + React + TypeScript + HeroUI + pnpm) that runs on
macOS/Windows and edits files inside a remote OpenShift/Dev Spaces container, through a small Go
agent it uploads and starts with `oc exec`. Its behavior copies the Neovim config in
`dev/configs/nvim`. See README.md for using, building and developing it.

User choices: connect with `oc exec` (pick project/pod/container); file explorer, tabs + Monaco
with save, terminals (xterm.js), source control tab, command palette, centered content and Vim
keybindings; macOS and Windows; Wails v3 (v3.0.0, needs Go ≥ 1.26).

## State

Everything in the original plan is built:

- **Wails v3**: `main.go` (service, window 1400×900 / min 640×400, close hook and `ShouldQuit`
  asking about unsaved changes, macOS menu with App + Edit roles, Hide's Cmd+H removed since
  Cmd+H is "previous tab"), `Taskfile.yml` + `build/` from a `wails3 init -t react` scaffold
  (pnpm, Monomyth / com.carlos.monomyth, icons from `build/appicon.png`). `build:agent` runs before
  every platform build. `wails.json` is gone.
- **Agent**: added `fs.files` and `fs.grep` (agent/search.go) for Cmd+P: ripgrep when present,
  otherwise `git ls-files` (respects .gitignore) / a walk, and a Go search.
- **Frontend**: `src/lib` (bridge via `Call.ByName("editor/internal/app.App.<Method>")` and
  `Events.On`, falling back to HTTP to `server/`; store; actions; commands; keys; connection;
  terminals; vim; settings; fuzzy) and `src/components` (ConnectScreen, Workspace with tab bar,
  status bar and split panes, EditorPane, TerminalPane, ScmPane, Explorer, CommandPalette,
  SearchModal, Welcome, Dialogs).
- The Wails Vite plugin isn't used: calls go by name, so `pnpm build`/`pnpm dev` work without
  generated bindings (the Taskfile still generates them; harmless).
- `vite.config.ts` aliases `monaco-editor/esm/...` and `monaco-vim`: monaco-vim 0.4.4 imports
  Monaco paths that Monaco 0.57's exports no longer map, and its "browser" build is stale.
- **Local editing**: the agent's code is `internal/agent` (cross-platform; terminals on
  go-pty, which is creack/pty on Unix and ConPTY on Windows). `agent/main.go` is the linux
  binary for containers. A `Target{local: true}` runs it in-process (`remote.InProcess`, over
  io.Pipe); the connect screen has a "This computer" section with the system folder picker
  (`App.PickFolder`). On macOS, Homebrew's bin folders are added to PATH for git and rg. On
  Windows, git/rg run with no console window, and paths are `C:/...` on the wire.

## Verified (in a Linux container)

- `go vet` (linux + windows), `tsc`, `pnpm build`, `oxlint` (warnings only, React-compiler
  advisories).
- `wails3 task windows:build ARCH=amd64` produces a working-looking `bin/Monomyth.exe` (PE x64,
  GUI subsystem, agents embedded). It hasn't been run on Windows.
- Browser tests with Playwright against the (since removed) Go devserver + a local agent: connect, welcome,
  file/text search, open at line, Vim editing, `:w`, `:%s` through the palette, theme preview,
  terminals, splits, closing a file with splits (terminals take the tab and keep their shell),
  unsaved-changes dialog, save-as, explorer new file, source control diff and push, agent
  killed → auto-reconnect → new shell on keypress, shell exit closes the pane.

## Not done / to check on real machines

- Run on macOS and Windows for real (WKWebView / WebView2 key handling, the clipboard through
  Wails, the menu, fonts), and against a real cluster and Dev Spaces workspace.
- Local editing on Windows hasn't been run: ConPTY terminals, drive-letter paths, git and
  search there are compiled and reviewed, not tested.
- macOS builds need a Mac (or `wails3 task setup:docker`).
- Splits use one direction per tab: splitting right and then below stacks all panes below.
- Files changed on disk by something else aren't reloaded in open tabs.
