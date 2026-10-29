// App state: a plain object with listeners, read in components through useStore(selector).
import { useSyncExternalStore } from 'react'
import type { Hello } from './agent'

export type Target = { project: string; pod: string; workspace?: string; container: string; folder: string }

export type Settings = {
  theme: string
  vim: boolean
  lineNumbers: boolean
  maxColumns: number
  fontSize: number
  fontFamily: string
  ocPath?: string
  recents: Target[]
}

export const defaultSettings: Settings = {
  theme: 'onedark',
  vim: true,
  lineNumbers: true,
  maxColumns: 120,
  fontSize: 14,
  fontFamily: '"JetBrainsMono Nerd Font", "JetBrains Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
  recents: [],
}

// Terminals split off beside a tab's content (Cmd+\ below, Cmd+Shift+\ to the right). Each
// pane has its own id; the tab's own content is the pane with the tab's id.
export type Splits = { dir: 'below' | 'right'; panes: string[] }

type TabBase = { id: string; splits?: Splits; focus?: string }
export type FileTab = TabBase & { kind: 'file'; path: string | null; dirty: boolean; line?: number; col?: number }
export type TerminalTab = TabBase & { kind: 'terminal'; cwd: string }
export type ScmTab = TabBase & { kind: 'scm' }
export type WelcomeTab = TabBase & { kind: 'welcome' }
export type Tab = FileTab | TerminalTab | ScmTab | WelcomeTab

export type Connection =
  | { state: 'idle'; error?: string }
  | { state: 'connecting'; status: string; target: Target }
  | { state: 'connected'; hello: Hello; target: Target }
  | { state: 'lost'; hello: Hello; target: Target; error: string; reconnecting?: boolean }

// What the status bar shows for a pane: the mode on the left, details on the right.
export type PaneStatus = { mode?: string; items: string[]; errors?: number; warnings?: number }

export type State = {
  platform: string
  settings: Settings
  conn: Connection
  tabs: Tab[]
  active: string | null
  explorer: boolean
  palette: null | { mode: 'commands' | 'themes'; text?: string }
  search: null | { kind: 'files' | 'text'; text: string }
  status: Record<string, PaneStatus>
  // Previewing a theme in the picker, without saving it.
  previewTheme: string | null
  // Counts connections to the agent: shells opened under an earlier one are gone.
  session: number
}

let state: State = {
  platform: 'darwin',
  settings: defaultSettings,
  conn: { state: 'idle' },
  tabs: [],
  active: null,
  explorer: false,
  palette: null,
  search: null,
  status: {},
  previewTheme: null,
  session: 0,
}

const listeners = new Set<() => void>()

export function get(): State {
  return state
}

export function set(update: Partial<State> | ((s: State) => Partial<State>)) {
  const patch = typeof update === 'function' ? update(state) : update
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state))
}

let nextId = 0
export function newId(prefix = 't'): string {
  return `${prefix}${++nextId}`
}

export function setPaneStatus(id: string, status: PaneStatus) {
  set((s) => ({ status: { ...s.status, [id]: status } }))
}

export function updateTab(id: string, patch: Partial<Tab>) {
  set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? ({ ...t, ...patch } as Tab) : t)) }))
}

export function activeTab(): Tab | undefined {
  return state.tabs.find((t) => t.id === state.active)
}

// The pane that has focus in a tab: a split terminal, or the tab's own content.
export function focusedPane(tab: Tab): string {
  return tab.focus && tab.splits?.panes.includes(tab.focus) ? tab.focus : tab.id
}

export const isMac = () => state.platform === 'darwin'

export function connected(): Hello | null {
  const c = state.conn
  return c.state === 'connected' || c.state === 'lost' ? c.hello : null
}
