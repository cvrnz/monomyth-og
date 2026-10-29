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

export type FileTab = { id: string; kind: 'file'; path: string | null; dirty: boolean }
export type TerminalTab = { id: string; kind: 'terminal'; cwd: string }
export type ScmTab = { id: string; kind: 'scm' }
export type WelcomeTab = { id: string; kind: 'welcome' }
export type Tab = FileTab | TerminalTab | ScmTab | WelcomeTab

export type Connection =
  | { state: 'idle'; error?: string }
  | { state: 'connecting'; status: string; target: Target }
  | { state: 'connected'; hello: Hello; target: Target }
  | { state: 'lost'; hello: Hello; target: Target; error: string; reconnecting?: boolean }

// What the status bar shows for a tab: the mode on the left, details on the right.
export type TabStatus = { mode?: string; items: string[]; errors?: number; warnings?: number }

export type State = {
  platform: string
  settings: Settings
  conn: Connection
  tabs: Tab[]
  active: string | null
  explorer: boolean
  palette: null | { mode: 'commands' | 'themes'; text?: string }
  status: Record<string, TabStatus>
  // Previewing a theme in the picker, without saving it.
  previewTheme: string | null
}

let state: State = {
  platform: 'darwin',
  settings: defaultSettings,
  conn: { state: 'idle' },
  tabs: [],
  active: null,
  explorer: false,
  palette: null,
  status: {},
  previewTheme: null,
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
export function newId(): string {
  return `t${++nextId}`
}

export function setTabStatus(id: string, status: TabStatus) {
  set((s) => ({ status: { ...s.status, [id]: status } }))
}

export function updateTab(id: string, patch: Partial<Tab>) {
  set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? ({ ...t, ...patch } as Tab) : t)) }))
}

export const isMac = () => state.platform === 'darwin'

export function connected(): Hello | null {
  const c = state.conn
  return c.state === 'connected' || c.state === 'lost' ? c.hello : null
}
