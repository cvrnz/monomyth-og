// The app's shortcuts, as in the nvim config: Cmd on macOS, Ctrl elsewhere.
//
// On macOS the Cmd shortcuts work everywhere, terminals included. Ctrl ones would take keys
// shells and Vim need (Ctrl+W, Ctrl+L, Ctrl+N, ...), so as in nvim they don't apply inside
// terminals or in Vim's insert mode (Ctrl+S aside); there, Ctrl+Shift+<key> does the same.
// They're caught before the editor or terminal sees them (a capturing listener on window).
import * as A from './actions'
import { isDialogOpen } from './dialogs'
import { pane } from './panes'
import * as S from './store'

type Binding = { code: string; shift?: boolean; run: () => void; always?: boolean }

const bindings: Binding[] = [
  { code: 'KeyW', run: () => A.closeFocused() },
  { code: 'KeyS', run: () => A.save(), always: true },
  { code: 'KeyN', run: () => A.newTab() },
  { code: 'KeyP', run: () => openSearch() },
  { code: 'KeyP', shift: true, run: () => S.set({ palette: { mode: 'commands' }, search: null, explorer: false }) },
  { code: 'KeyG', run: () => A.openScm() },
  { code: 'KeyE', run: () => A.toggleExplorer() },
  { code: 'KeyT', run: () => A.openTerminal() },
  { code: 'Backslash', run: () => A.splitTerminal('below') },
  { code: 'Backslash', shift: true, run: () => A.splitTerminal('right') },
  { code: 'KeyH', run: () => A.cycleTab(-1) },
  { code: 'KeyL', run: () => A.cycleTab(1) },
  { code: 'KeyJ', run: () => A.cyclePane(1) },
  { code: 'KeyK', run: () => A.cyclePane(-1) },
]

function openSearch() {
  const s = S.get()
  S.set({ search: s.search ? null : { kind: 'files', text: '' }, palette: null, explorer: false })
  if (s.search) A.focusActive()
}

// Where the key went: a terminal, or an editor in Vim's insert mode.
function inTerminal(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('.xterm'))
}

function inVimInsert() {
  const tab = S.activeTab()
  return Boolean(tab && pane(S.focusedPane(tab))?.vimInsert?.())
}

function onKeyDown(e: KeyboardEvent) {
  if (isDialogOpen() || e.altKey) return
  const mac = S.isMac()
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (!mod) return
  const connected = S.get().conn.state === 'connected' || S.get().conn.state === 'lost'
  if (!connected) return

  // A shortcut with Shift if there is one, else (off macOS) Ctrl+Shift+<key> stands in for
  // Ctrl+<key>, and always works.
  let b = bindings.find((x) => x.code === e.code && Boolean(x.shift) === e.shiftKey)
  if (!b && !mac && e.shiftKey) b = bindings.find((x) => x.code === e.code && !x.shift)
  if (!b) return
  if (!mac && !e.shiftKey && !b.always && (inTerminal(e.target) || inVimInsert())) return
  e.preventDefault()
  e.stopPropagation()
  b.run()
}

export function installKeys(): () => void {
  window.addEventListener('keydown', onKeyDown, true)
  return () => window.removeEventListener('keydown', onKeyDown, true)
}
