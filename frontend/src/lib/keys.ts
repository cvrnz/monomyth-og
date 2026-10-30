// The app's shortcuts, as in the nvim config: Cmd on macOS, Ctrl elsewhere.
//
// They work everywhere: in Vim's insert mode and in terminals too. Off macOS, Ctrl+Shift+<key>
// does the same as Ctrl+<key>, except in a terminal taking input, where it sends Ctrl+<key>
// to the shell instead (TerminalPane), so Ctrl+Shift+C is Ctrl+C there.
// They're caught before the editor or terminal sees them (a capturing listener on window).
import * as A from './actions'
import { isDialogOpen } from './dialogs'
import { pane } from './panes'
import * as S from './store'

// project: works on the connect screen too, to switch to another project.
type Binding = { code: string; shift?: boolean; run: () => void; project?: boolean }

const bindings: Binding[] = [
  { code: 'KeyW', run: () => A.closeFocused() },
  { code: 'KeyS', run: () => A.save() },
  { code: 'KeyN', run: () => A.newTab() },
  { code: 'KeyP', run: () => openPalette() },
  { code: 'KeyF', run: () => openSearch() },
  { code: 'KeyG', run: () => A.openScm() },
  { code: 'KeyE', run: () => A.toggleExplorer() },
  { code: 'KeyT', run: () => A.openTerminal() },
  { code: 'Backslash', run: () => A.splitTerminal('below') },
  { code: 'Backslash', shift: true, run: () => A.splitTerminal('right') },
  { code: 'KeyH', run: () => A.cycleTab(-1) },
  { code: 'KeyL', run: () => A.cycleTab(1) },
  { code: 'KeyJ', run: () => A.cyclePane(1) },
  { code: 'KeyK', run: () => A.cyclePane(-1) },
  // Cmd+1 ... Cmd+9: switch projects.
  ...Array.from({ length: 9 }, (_, i): Binding => ({ code: `Digit${i + 1}`, run: () => A.switchToProject(i), project: true })),
]

function openPalette() {
  const s = S.get()
  S.set({ palette: s.palette ? null : { mode: 'commands' }, previewTheme: null, search: null, explorer: false })
  if (s.palette) A.focusActive()
}

function openSearch() {
  const s = S.get()
  S.set({ search: s.search ? null : { kind: 'files', text: '' }, palette: null, explorer: false })
  if (s.search) A.focusActive()
}

// Whether the key went to a terminal taking input (not in its normal mode).
function inTerminal(target: EventTarget | null) {
  if (!(target instanceof Element && target.closest('.xterm'))) return false
  const tab = S.activeTab()
  return pane(tab && S.focusedPane(tab))?.shellInput?.() ?? true
}

function onKeyDown(e: KeyboardEvent) {
  if (isDialogOpen() || e.altKey) return
  // Esc closes search and the palette wherever the focus is (their preview, say).
  if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    const s = S.get()
    if (s.search || s.palette) {
      e.preventDefault()
      e.stopPropagation()
      S.set({ search: null, palette: null, previewTheme: null })
      A.focusActive()
    }
    return
  }
  const mac = S.isMac()
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (!mod) return
  const connected = S.isConnected(S.get().conn)
  const switching = S.get().projects.length > 1
  if (!connected && !switching) return

  // A shortcut with Shift if there is one, else (off macOS, outside a terminal's input)
  // Ctrl+Shift+<key> stands in for Ctrl+<key>.
  let b = bindings.find((x) => x.code === e.code && Boolean(x.shift) === e.shiftKey)
  if (!b && !mac && e.shiftKey && !inTerminal(e.target)) b = bindings.find((x) => x.code === e.code && !x.shift)
  if (!b || (!connected && !b.project)) return
  e.preventDefault()
  e.stopPropagation()
  b.run()
}

export function installKeys(): () => void {
  window.addEventListener('keydown', onKeyDown, true)
  return () => window.removeEventListener('keydown', onKeyDown, true)
}
