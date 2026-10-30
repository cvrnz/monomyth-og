# Monomyth

Monomyth is an editor that runs in an app window (Edge or Chrome) on macOS, Windows and Linux, for files on your computer or inside an OpenShift /
Dev Spaces container. For a container it uses your `oc` login: pick a project, pod and
container, and the app uploads a small agent into it (`oc exec`) that reads and writes files,
runs shells and git. For local files a Node server on your computer does the same work. It behaves like the Neovim config in `dev/configs/nvim`: the same shortcuts, tab bar,
status bar, command palette, explorer and source control tabs, centered content and
themes. It also has SQL tabs, for querying databases.

Built with Node, React, TypeScript, HeroUI, Monaco (with monaco-vim) and xterm.js.

## Using it

- **This computer**: choose a folder (or type its path) and press **Open**. Terminals run
  your login shell (PowerShell on Windows); source control uses the `git` you have installed.
- **A container**: log in once in a terminal (`oc login ...`), then pick the project, the
  workspace pod and the container, optionally a folder (the default is the workspace's
  projects folder), and press **Connect**.

Recent folders and containers are listed at the top; a Dev Spaces workspace is found again
after it restarts with a new pod name.

Shortcuts use Cmd on macOS and Ctrl on Windows:

| Shortcut | Action |
|----------|--------|
| W | Close the tab or split (asks about unsaved changes; the Explorer and Git tabs stay, and closing the last other tab leaves a welcome screen) |
| S | Save (asks for a path for a new file) |
| N | New tab |
| P | Command palette |
| F | Search file names; Tab switches to searching text |
| G | Git (source control); again to go back to the tab you were on |
| E | File explorer; again to go back to the tab you were on |
| T | Terminal in a new tab |
| D | SQL (database) in a new tab |
| \\ | Terminal split below |
| Shift+\\ | Terminal split to the right |
| H / L | Previous / next tab |
| J / K | Next / previous pane: the parts of Explorer, Git and SQL (sidebar, editor, results), then splits |
| 1 … 9 | Switch to the first … ninth project |

Several projects (containers or local folders) can be open in one window, each with its own
connection, tabs and terminals. They're listed left of the tabs: `+` (or the `NewProject`
command) opens another on the connect screen, a middle click or `Disconnect` closes one, and
Cmd+1, Cmd+2, ... (Ctrl on Windows) switch between them. This works with the Node server
(`scripts/dev.sh`); the desktop app's Go backend still has a single connection.

Monomyth opens where you left off: the projects that were open reconnect, and their tabs come
back once connected (files at the same cursor, terminals, source control, the explorer, SQL
tabs with their query and connection, splits, the current tab and project). Unsaved changes and untitled files aren't kept, and terminals start new
shells. If a project can't reconnect, its connect screen shows why, and its tabs come back
when you connect it to the same place. This is saved as `session` in the settings file.

The Explorer, Git and SQL tabs show a line of hints at the bottom: the keys for the part that
has the focus (the sidebar, the query, the results, ...) and how to move to the next part.
Their sidebars can be resized by dragging the line beside them (double-click it for the default
width); the widths are kept as `sideWidths` in the settings file.

Shortcuts work everywhere, Vim's insert mode and terminals included. On Windows, Ctrl+Shift+<key>
also works as Ctrl+<key>, except in a terminal, where it sends Ctrl+<key> to the shell instead
(Ctrl+Shift+C for Ctrl+C, Ctrl+Shift+W to delete a word, ...). Esc closes search and the command
palette wherever the focus is. Ctrl+C copies selected terminal text (and is Ctrl+C otherwise),
Ctrl+V pastes. Selecting text in a terminal copies it.

In a terminal, Esc Esc switches to normal mode, as in nvim (a single Esc still goes to the
shell): `h`/`j`/`k`/`l`, `w`/`b`/`e`, `0`/`^`/`$`, `gg`/`G`, `H`/`M`/`L` and Ctrl+U/D/B/F/E/Y
move through the output and scrollback, `v`/`V` select, `y` copies (`yy` the line), `/` and
`?` search (`n`/`N` repeat). `i`, `a` or Enter goes back to
the shell.

The command palette runs the app's commands (`Themes`, `ToggleLineNumbers`, `ToggleVim`,
`FontSize 15`, `MaxColumns 100`, `Reconnect`, `NewProject`, `Disconnect`, ...) and, in a file with Vim
keybindings, any Ex command (`w`, `e path`, `%s/a/b/g`, `10`, `sort`; `:` in the file opens Vim's own
prompt for those too). Tab completes the highlighted command.

Every project's first two tabs are Explorer and Git, which can't be closed; the tabs you open
come after them.

- **Explorer** (Cmd+E, again to go back): the folder's tree and a preview of the selected
  file, showing the file that was open. `j`/`k` move, `l`/Enter open or expand, `h` collapse,
  `a` new file (end with `/` for a folder), `r` rename or move, `d` delete, `y` copy the path,
  `R` refresh. Files open in a tab of their own. Files with uncommitted changes show in their Git
  status's color and letter (`M` modified, `U` untracked, `A` added, `R` renamed), and folders
  holding any with a dot.
- **SQL** (Cmd+D, the `Sql` command, or `Sql <saved connection>`): a tab connected to a PostgreSQL,
  MySQL/MariaDB, SQL Server or SQLite database. Queries run from this computer (not in the
  container), with the Node server (`scripts/dev.sh`). The left lists the saved connections
  (`a` new, `e` edit, `d` delete, Enter connect); connected, it lists the tables and views (by
  schema when there are several) and their columns: `l`/`h` expand and collapse, Enter shows a
  table's first 100 rows, `i` inserts the name in the query, `y` copies it, `R` refreshes.
  Cmd+Enter (Ctrl+Enter) in the editor runs the selection, or all of it; several statements
  give several results. Each result is a table (up to 10,000 rows): `h`/`j`/`k`/`l` move, `y`
  or Cmd+C copies the cell, `Y` the row. Messages shows rows affected, notices and errors
  (PostgreSQL's mark where in the query). Cancel stops a running query. SQLite takes a file
  path (`C:\...` and `~/...` work, or `:memory:`); SQL Server signs in with Windows
  authentication for a `DOMAIN\user` name. Connections, passwords included, are saved as
  `sqlConnections` in the settings file.
- **Git** (Cmd+G, again to go back): Repos and Changes lists (Tab switches), a side-by-side diff of
  the selected file, and a sync button that pulls, pushes or publishes the branch. Enter on a
  file opens it.
- **Welcome**: Tab shows another piece of art; `i`, `a` or `o` starts a new file.

Settings (theme, Vim on/off, line numbers, font, centered width, the path to `oc`, recent
connections) are saved in the user config folder (`~/Library/Application Support/monomyth`
on macOS, `%AppData%\monomyth` on Windows, `~/.config/monomyth` on Linux and WSL).

Your own themes go in a `themes` folder there, one JSON file each, and are listed first in
`Themes` (which re-reads the folder each time it opens). The name is the file's unless the
file gives a `name`; one with a built-in theme's name replaces it. Every color is `#rrggbb`:

```json
{
  "name": "darq",
  "bg": "#151515",        "dark": "#1e1e1e",   "raised": "#252525", "selection": "#1e334f",
  "fg": "#f1f2f4",        "dim": "#8f9299",
  "red": "#e94646",       "green": "#11c965",  "yellow": "#f7b750", "orange": "#f7b750",
  "blue": "#6da6f5",      "purple": "#b699eb", "cyan": "#71d0d5"
}
```

`bg` is the background, `dark` floating windows and popups, `raised` the cursor line and
selected tab, `selection` selected text, `fg` text, `dim` comments and muted text; the rest
color code (`orange` numbers and constants, `purple` keywords, `blue` functions, `green`
strings, `cyan` types). The folder can be a link to one kept elsewhere, like a dotfiles repo.

If the connection drops, the app reconnects once by itself and otherwise shows a Reconnect
button; open files and unsaved changes stay, and terminals start a new shell when typed in.

## Running it

It runs as a Node server (`server/`, the app's service over HTTP on
:34115), Vite (http://127.0.0.1:9245), and an app window (Edge or Chrome with `--app`, on its
own profile; no tabs or address bar). Needs Node 22.18+ and pnpm. Closing the window (or
Ctrl+C) stops everything; `--browser` / `-Browser` skips the window. In Git Bash (or on
macOS/Linux):

```sh
./scripts/dev.sh
```

In PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
```

"This computer" works there, including the folder picker. Under WSL the
picker is Windows' own, and Windows paths (`C:\Users\...`) open as their `/mnt/c/...` folders. Connecting to a
container uploads the Go agent from `agent/bin/`, so build it once with
`go run ./scripts/buildagent` (needs Go 1.26+; the scripts do this when Go is installed).

Checks: `GOOS=linux go vet ./...`, `cd frontend && pnpm build && pnpm lint`,
`cd server && pnpm typecheck && pnpm test`.

## Layout

- `internal/agent` — the Go agent that does the work inside a container: newline-delimited
  JSON requests and events. Files (`fs.*`, including `fs.files`/`fs.grep` search, using
  ripgrep when it's installed), shells (`term.*`, on a pty via go-pty) and git (`scm.*`).
- `agent/` — the agent binary for containers (linux), serving `internal/agent` over
  stdin/stdout; `go run ./scripts/buildagent` builds it into `agent/bin/`.
- `internal/proto` — the agent's wire format.
- `server/` — the app's service in Node (TypeScript run directly by Node, no build), for the
  browser: `src/local` ports `internal/agent` for this computer (terminals on node-pty) and
  `src/remote.ts` connects to containers with `oc` and the Go agent. `src/sql` runs the SQL
  tabs' queries (pg, mysql2, mssql, and Node's own SQLite in a child process so a query can
  be stopped).
- `frontend/src/lib` — the bridge to the backend, app state, actions, commands, shortcuts, themes.
  `frontend/src/components` — the screens and panes.
