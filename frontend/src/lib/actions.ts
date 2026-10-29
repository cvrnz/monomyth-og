// What the shortcuts, the palette and the menus do: opening and closing tabs, splits, saving.
// Behaves like the nvim config: files open in the current tab when it's empty, otherwise in a
// new tab after it; closing the last tab quits.
import { agent } from './agent'
import { errorText, inWails, invoke } from './bridge'
import { choose, prompt, toast } from './dialogs'
import { pane } from './panes'
import { basename, join, normalize } from './paths'
import * as S from './store'

export function root(): string {
  return S.connected()?.root ?? '/'
}

function insertTab(tab: S.Tab) {
  S.set((s) => {
    const tabs = [...s.tabs]
    const i = tabs.findIndex((t) => t.id === s.active)
    tabs.splice(i + 1, 0, tab)
    return { tabs, active: tab.id, explorer: false }
  })
}

// Swaps a tab for another in the same place (a file opening where the welcome screen was).
function replaceTab(id: string, tab: S.Tab) {
  S.set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? tab : t)), active: tab.id, explorer: false }))
}

// The welcome screen, or an untitled file with nothing typed in it.
function isEmpty(tab: S.Tab | undefined): boolean {
  if (!tab || tab.splits) return false
  if (tab.kind === 'welcome') return true
  return tab.kind === 'file' && tab.path === null && !tab.dirty && (pane(tab.id)?.isEmpty?.() ?? true)
}

export function activate(id: string) {
  S.set({ active: id })
  focusActive()
}

export function focusActive() {
  const tab = S.activeTab()
  if (!tab) return
  requestAnimationFrame(() => pane(S.focusedPane(tab))?.focus())
}

export function openFile(path: string, line?: number, col?: number) {
  path = normalize(path)
  const existing = S.get().tabs.find((t) => t.kind === 'file' && t.path === path)
  if (existing) {
    S.set({ active: existing.id, explorer: false })
    if (line) pane(existing.id)?.reveal?.(line, col)
    focusActive()
    return
  }
  const tab: S.FileTab = { id: S.newId(), kind: 'file', path, dirty: false, line, col }
  const current = S.activeTab()
  if (isEmpty(current)) replaceTab(current!.id, tab)
  else insertTab(tab)
}

export function newTab() {
  insertTab({ id: S.newId(), kind: 'file', path: null, dirty: false })
}

// An untitled file in place of the welcome screen (typing i, a or o there).
export function newFileHere() {
  const tab: S.FileTab = { id: S.newId(), kind: 'file', path: null, dirty: false }
  const current = S.activeTab()
  if (current?.kind === 'welcome' && !current.splits) replaceTab(current.id, tab)
  else insertTab(tab)
}

export function openWelcome() {
  const current = S.activeTab()
  const tab: S.WelcomeTab = { id: S.newId(), kind: 'welcome' }
  if (isEmpty(current)) replaceTab(current!.id, tab)
  else insertTab(tab)
}

export function openTerminal() {
  insertTab({ id: S.newId(), kind: 'terminal', cwd: root() })
}

// A terminal beside the current tab's content, below or to the right.
export function splitTerminal(dir: S.Splits['dir']) {
  const tab = S.activeTab()
  if (!tab) return openTerminal()
  const id = S.newId('p')
  const panes = [...(tab.splits?.panes ?? []), id]
  S.updateTab(tab.id, { splits: { dir, panes }, focus: id })
  S.set({ explorer: false })
}

export function openScm() {
  insertTab({ id: S.newId(), kind: 'scm' })
}

export function toggleExplorer() {
  S.set((s) => ({ explorer: !s.explorer, palette: null, search: null }))
  if (!S.get().explorer) focusActive()
}

export function cycleTab(step: number) {
  const { tabs, active } = S.get()
  if (tabs.length === 0) return
  const i = tabs.findIndex((t) => t.id === active)
  activate(tabs[(i + step + tabs.length) % tabs.length].id)
}

export function focusPane(tabId: string, paneId: string) {
  const tab = S.get().tabs.find((t) => t.id === tabId)
  if (tab && tab.focus !== paneId) S.updateTab(tabId, { focus: paneId })
}

// Moves focus between a tab's panes (Cmd+J / Cmd+K, like moving between windows).
export function cyclePane(step: number) {
  const tab = S.activeTab()
  if (!tab?.splits) return
  const all = [tab.id, ...tab.splits.panes]
  const i = all.indexOf(S.focusedPane(tab))
  const next = all[(i + step + all.length) % all.length]
  S.updateTab(tab.id, { focus: next })
  focusActive()
}

// Cmd+W: closes the focused pane, or the tab when it's the tab's own content.
export async function closeFocused() {
  const tab = S.activeTab()
  if (!tab) return
  const focused = S.focusedPane(tab)
  if (focused !== tab.id) closePane(tab.id, focused)
  else await closeTab(tab.id)
}

export function closePane(tabId: string, paneId: string) {
  const tab = S.get().tabs.find((t) => t.id === tabId)
  if (!tab?.splits) return
  const panes = tab.splits.panes.filter((p) => p !== paneId)
  S.updateTab(tabId, { splits: panes.length ? { ...tab.splits, panes } : undefined, focus: tabId })
  focusActive()
}

// Asks about unsaved changes; false if the user cancelled.
async function settle(tab: S.Tab): Promise<boolean> {
  if (tab.kind !== 'file' || !tab.dirty) return true
  const name = tab.path ? basename(tab.path) : 'Untitled'
  const choice = await choose(`Save changes to ${name}?`, "Your changes will be lost if you don't save them.", [
    { label: 'Cancel', value: 'cancel', variant: 'tertiary' },
    { label: "Don't save", value: 'discard', variant: 'secondary' },
    { label: 'Save', value: 'save', variant: 'primary' },
  ])
  if (choice === 'save') return (await pane(tab.id)?.save?.()) ?? false
  return choice === 'discard'
}

export async function closeTab(id: string) {
  const tab = S.get().tabs.find((t) => t.id === id)
  if (!tab || !(await settle(tab))) return
  const { tabs, active } = S.get()
  const i = tabs.findIndex((t) => t.id === id)
  // Split terminals outlive the content they were split from: the first one takes the tab.
  if (tab.splits) {
    const [first, ...rest] = tab.splits.panes
    const promoted: S.TerminalTab = {
      id: first,
      kind: 'terminal',
      cwd: root(),
      splits: rest.length ? { ...tab.splits, panes: rest } : undefined,
    }
    S.set({ tabs: tabs.map((t) => (t.id === id ? promoted : t)), active: active === id ? first : active })
    focusActive()
    return
  }
  const remaining = tabs.filter((t) => t.id !== id)
  if (remaining.length === 0) {
    S.set({ tabs: [], active: null })
    await quit()
    return
  }
  // Like closing a tab in nvim: the one before it becomes current (the next one for the first).
  const nextActive = active === id ? remaining[Math.max(0, i - 1)].id : active
  S.set({ tabs: remaining, active: nextActive })
  focusActive()
}

export async function save(as = false) {
  const tab = S.activeTab()
  if (!tab) return
  const target = pane(S.focusedPane(tab))
  if (target?.save) await target.save(as)
}

export async function saveAll(): Promise<boolean> {
  for (const tab of S.get().tabs) {
    if (tab.kind === 'file' && tab.dirty) {
      if (!(await pane(tab.id)?.save?.())) return false
    }
  }
  return true
}

// A path for a new or untitled file, relative to the folder unless it starts with / or ~.
export async function askPath(title: string, initial = ''): Promise<string | null> {
  const hello = S.connected()
  const value = await prompt(title, initial, `Relative to ${hello?.root ?? '/'}`)
  if (!value?.trim()) return null
  return resolvePath(value.trim())
}

export function resolvePath(value: string): string {
  const hello = S.connected()
  if (value === '~' || value.startsWith('~/')) return join(hello?.home ?? '/', value.slice(1))
  return join(root(), value)
}

// Asks before writing over a file that's already there.
export async function okToWrite(path: string): Promise<boolean> {
  try {
    const st = await agent.stat(path)
    if (st.dir) {
      toast(`${path} is a folder`, 'error')
      return false
    }
    if (!st.exists) return true
  } catch (err) {
    toast(errorText(err), 'error')
    return false
  }
  const choice = await choose(`${basename(path)} already exists`, 'Do you want to replace it?', [
    { label: 'Cancel', value: 'cancel', variant: 'tertiary' },
    { label: 'Replace', value: 'replace', variant: 'danger' },
  ])
  return choice === 'replace'
}

export function dirtyCount(): number {
  return S.get().tabs.filter((t) => t.kind === 'file' && t.dirty).length
}

// Quitting with unsaved changes asks first. In a browser (the dev server) there's no window to
// close, so the welcome screen comes back instead.
export async function quit() {
  const n = dirtyCount()
  if (n > 0) {
    const choice = await choose(
      n === 1 ? 'Save changes to 1 file before quitting?' : `Save changes to ${n} files before quitting?`,
      "Your changes will be lost if you don't save them.",
      [
        { label: 'Cancel', value: 'cancel', variant: 'tertiary' },
        { label: "Don't save", value: 'discard', variant: 'secondary' },
        { label: 'Save all', value: 'save', variant: 'primary' },
      ],
    )
    if (choice === 'cancel') return
    if (choice === 'save' && !(await saveAll())) return
  }
  if (inWails) {
    await invoke('Quit')
  } else if (S.get().tabs.length === 0) {
    openWelcome()
  }
}
