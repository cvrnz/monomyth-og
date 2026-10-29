# Editor

A desktop editor for macOS and Windows that edits files inside an OpenShift / Dev Spaces
container. It connects with your `oc` login: pick a project, pod and container, and the app
uploads a small agent into the container (`oc exec`) that reads and writes files, runs shells
and git. It behaves like the Neovim config in `dev/configs/nvim`: the same shortcuts, tab bar,
status bar, command palette, floating explorer, source control tab, centered content and
themes.

Built with Wails v3, React, TypeScript, HeroUI, Monaco (with monaco-vim) and xterm.js.

## Using it

1. Log in once in a terminal: `oc login ...` (the app uses that login).
2. Open the app, pick the project, the workspace pod and the container, optionally a folder
   (the default is the workspace's projects folder), and press **Connect**. Recent
   connections are listed at the top; a Dev Spaces workspace is found again after it
   restarts with a new pod name.

Shortcuts use Cmd on macOS and Ctrl on Windows:

| Shortcut | Action |
|----------|--------|
| W | Close the tab or split (asks about unsaved changes; closing the last tab quits) |
| S | Save (asks for a path for a new file) |
| N | New tab |
| P | Search file names; Tab switches to searching text |
| G | Source control |
| E | File explorer |
| T | Terminal in a new tab |
| \\ | Terminal split below |
| Shift+\\ | Terminal split to the right |
| H / L | Previous / next tab |
| J / K | Next / previous split |
| Shift+P | Command palette (also `:` in a file, the welcome screen and source control) |

On Windows, plain Ctrl shortcuts are left to the shell inside terminals and to Vim's insert
mode (so Ctrl+W, Ctrl+L and the rest keep working there); use Ctrl+Shift+<key> instead.
Ctrl+C copies selected terminal text and Ctrl+V pastes. Selecting text in a terminal copies it.

The command palette runs the app's commands (`Themes`, `ToggleLineNumbers`, `ToggleVim`,
`FontSize 15`, `MaxColumns 100`, `Reconnect`, `Disconnect`, ...) and, in a file with Vim
keybindings, any Ex command (`w`, `e path`, `%s/a/b/g`, `10`, `sort`). Tab completes the
highlighted command.

- **Explorer** (Cmd+E): `j`/`k` move, `l`/Enter open or expand, `h` collapse, `a` new file
  (end with `/` for a folder), `r` rename or move, `d` delete, `y` copy the path, `R` refresh.
- **Source control** (Cmd+G): Repos and Changes lists (Tab switches), a side-by-side diff of
  the selected file, and a sync button that pulls, pushes or publishes the branch. Enter on a
  file opens it.
- **Welcome**: Tab shows another piece of art; `i`, `a` or `o` starts a new file.

Settings (theme, Vim on/off, line numbers, font, centered width, the path to `oc`, recent
connections) are saved in the user config folder (`~/Library/Application Support/editor` on
macOS, `%AppData%\editor` on Windows).

If the connection drops, the app reconnects once by itself and otherwise shows a Reconnect
button; open files and unsaved changes stay, and terminals start a new shell when typed in.

## Building

Needs Go 1.26+, Node 22+, pnpm and the Wails v3 CLI:

```sh
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0
```

Then, on the platform you're building for:

```sh
wails3 build          # bin/editor on macOS, bin/editor.exe on Windows
wails3 package        # the macOS .app bundle / the Windows installer
```

The build first compiles the container agent for linux/amd64 and linux/arm64
(`go run ./scripts/buildagent`, into `internal/remote/agentbin/`) and embeds it. A Windows
build can also be made from Linux or macOS: `wails3 task windows:build ARCH=amd64`. A macOS
build needs a Mac (or `wails3 task setup:docker` for cross-compiling).

## Developing

`wails3 dev` runs the app with hot reload.

The UI can also be worked on in a plain browser, against an agent running on this machine
instead of a cluster (no Wails or `oc` needed, but Linux only, since the agent is):

```sh
go build -o /tmp/editor-agent ./agent
go run ./cmd/devserver -agent /tmp/editor-agent     # serves the app's methods on :34115
cd frontend && pnpm dev                             # http://127.0.0.1:9245
```

Checks: `go vet ./agent ./internal/... ./cmd/...`, `cd frontend && pnpm build && pnpm lint`.

## Layout

- `agent/` — runs in the container: newline-delimited JSON over stdin/stdout. Files (`fs.*`,
  including `fs.files`/`fs.grep` search, using ripgrep when the container has it), shells
  (`term.*`) and git (`scm.*`).
- `internal/proto` — the wire format. `internal/remote` — finding `oc`, listing projects and
  pods, uploading and starting the agent. `internal/app` — the service the window calls.
- `main.go` — the Wails app and window. `cmd/devserver` — the same service over HTTP.
- `frontend/src/lib` — the bridge to Go, app state, actions, commands, shortcuts, themes.
  `frontend/src/components` — the screens and panes.
