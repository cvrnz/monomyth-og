# Handoff notes

## A native Windows build

You should still support a native Windows build even though we're going to run it from dev
(`scripts/dev.sh` in WSL). Nothing builds one yet. A Windows build is a Windows `.exe`, so it
isn't for the work machine (see AGENTS.md); it's for a Windows machine where that's fine, and
it's built there (Electrobun builds for the platform it runs on).

What's already in place:

- The server handles native Windows (`process.platform === 'win32'`, `isWindows` in
  `server/src/wire.ts`): ConPTY terminals through node-pty (`server/src/local/term.ts`; Bun's
  own pseudo-terminal doesn't exist on Windows), PowerShell 7, Windows PowerShell or cmd as the
  shell, `C:/...` paths on the wire, `oc.exe` lookup (`server/src/remote.ts`), settings in
  `%APPDATA%\monomyth`, and the PowerShell folder picker (`server/src/app.ts`).
- The frontend uses Ctrl for its shortcuts off macOS (`frontend/src/lib/keys.ts`), with
  Ctrl+Shift+<key> also working outside terminals.
- `desktop/scripts/stage.ts` uses only Bun and Go, which both run on Windows.

What it needs:

1. **Run the server under Bun on Windows** (`bun server/src/main.ts`) and fix what breaks. None
   of the Windows code has run under Bun, and node-pty has never been tried under Bun, so
   check terminals first (open, type, resize, exit). Also check `fork` of the SQLite child
   process (`server/src/sql/sqlite.ts`), git, ripgrep search and the folder picker.
2. **`desktop/src/main.ts` for Windows:**
   - Skip `loginPath()` (it asks a Unix login shell for PATH; Windows apps get the user's PATH).
   - The menu: Windows has no menu bar at the top of the screen, and Electrobun's menu support
     there is partial. Decide between no menu (the page has its own shortcuts and command
     palette) or a window menu, and use `control+...` shortcuts. Copy and paste need checking
     in WebView2 without the macOS Edit menu.
   - The window: `titleBarStyle: "hidden"` gives resize handles without a system title bar on
     Windows. Check that the top row's drag region, double-click zoom and the right-click
     window menu (`frontend/src/lib/window.ts`) work in WebView2, and that the
     right-click-drag fix there is still right.
   - `quitNow()` and the server's `SIGTERM`: on Windows `server.kill()` ends the server without
     its cleanup handler, so shells in terminals may be left running. Tell it to stop over IPC
     instead (it already stops when the IPC channel closes, `process.on('disconnect')`).
3. **`desktop/electrobun.config.ts`:** add `build.win` with `icon` (an `.ico`, or a PNG made
   from `desktop/assets/icon-square.svg`; Windows icons are square, not the macOS rounded
   tile), and keep `bundleCEF: false` to use WebView2, which comes with Windows 10 and 11.
4. **Build on Windows:** `cd desktop && bun install && bun run build`, then check the installer
   in `desktop/artifacts`. Unsigned builds show a SmartScreen warning.
5. **Docs:** a "The Windows app" section in the README next to "The macOS app", and the
   Windows build added to AGENTS.md's description of how Monomyth runs.
