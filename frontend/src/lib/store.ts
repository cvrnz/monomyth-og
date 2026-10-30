// App state: a plain object with listeners, read in components through useStore(selector).
import { createContext, useContext, useSyncExternalStore } from 'react'
import type { Hello } from './agent'

// A container (project, pod, container), or this computer (local). folder is the folder to
// open, or empty for the default.
export type Target = { local?: boolean; project: string; pod: string; workspace?: string; container: string; folder: string }

export function localTarget(folder: string): Target {
  return { local: true, project: '', pod: '', container: '', folder }
}

export type Settings = {
  theme: string
  vim: boolean
  lineNumbers: boolean
  maxColumns: number
  fontSize: number
  fontFamily: string
  ocPath?: string
  recents: Target[]
  // Databases saved in SQL tabs, passwords included.
  sqlConnections?: SqlConnection[]
  // What was open when the app last closed, reopened at start (lib/session.ts).
  session?: SavedSession
}

// A tab as saved for next time: files by path (untitled ones aren't kept), with the cursor;
// splits by how many terminals they had.
export type SavedTab = (
  | { kind: 'file'; path: string; line?: number; col?: number }
  | { kind: 'terminal'; cwd: string }
  | { kind: 'scm' }
  | { kind: 'welcome' }
  | { kind: 'explorer' }
  | { kind: 'sql'; conn?: string; text?: string }
) & { splits?: { dir: Splits['dir']; count: number } }

export type SavedProject = { target: Target; tabs: SavedTab[]; active: number }
export type SavedSession = { projects: SavedProject[]; current: number }

export const defaultSettings: Settings = {
  theme: 'onedark',
  vim: true,
  lineNumbers: true,
  maxColumns: 120,
  fontSize: 16,
  fontFamily: '"JetBrainsMono Nerd Font", "JetBrains Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
  recents: [],
}

export type SqlEngine = 'postgres' | 'mysql' | 'mssql' | 'sqlite'

// A database a SQL tab connects to (from this computer), saved by name. SQLite uses file;
// the others the rest.
export type SqlConnection = {
  name: string
  engine: SqlEngine
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  file?: string
  ssl?: boolean
  trustCert?: boolean
}

// Terminals split off beside a tab's content (Cmd+\ below, Cmd+Shift+\ to the right). Each
// pane has its own id; the tab's own content is the pane with the tab's id.
export type Splits = { dir: 'below' | 'right'; panes: string[] }

type TabBase = { id: string; splits?: Splits; focus?: string }
export type FileTab = TabBase & { kind: 'file'; path: string | null; dirty: boolean; line?: number; col?: number }
export type TerminalTab = TabBase & { kind: 'terminal'; cwd: string }
export type ScmTab = TabBase & { kind: 'scm' }
export type WelcomeTab = TabBase & { kind: 'welcome' }
// The project's files; reveal is the file to show (the one that was open when it was asked for).
export type ExplorerTab = TabBase & { kind: 'explorer'; reveal?: string }
// conn names the saved connection it uses; text is what's typed in it.
export type SqlTab = TabBase & { kind: 'sql'; conn?: string; text?: string }
export type Tab = FileTab | TerminalTab | ScmTab | WelcomeTab | ExplorerTab | SqlTab

// Every connected project's first two tabs: the explorer, then Git. They can't be closed.
export function isFixed(t: Tab): boolean {
  return t.kind === 'explorer' || t.kind === 'scm'
}

// The tabs in order: the explorer and Git (made if missing, one of each) before the rest, and
// a welcome screen when there's nothing else.
export function withFixed(tabs: Tab[]): Tab[] {
  const explorer = tabs.find((t) => t.kind === 'explorer') ?? { id: newId(), kind: 'explorer' }
  const git = tabs.find((t) => t.kind === 'scm') ?? { id: newId(), kind: 'scm' }
  const rest = tabs.filter((t) => !isFixed(t))
  return [explorer, git, ...(rest.length ? rest : [{ id: newId(), kind: 'welcome' } as WelcomeTab])]
}

export type Connection =
  | { state: 'idle'; error?: string }
  | { state: 'connecting'; status: string; target: Target }
  | { state: 'connected'; hello: Hello; target: Target }
  | { state: 'lost'; hello: Hello; target: Target; error: string; reconnecting?: boolean }

// What the status bar shows for a pane: the mode on the left, details on the right.
export type PaneStatus = { mode?: string; items: string[]; errors?: number; warnings?: number }

// A place being worked on: its connection and its tabs. The window can hold several (each with
// its own connection to an agent), switched between with Cmd+1, Cmd+2, ...
export type Project = {
  id: string
  conn: Connection
  tabs: Tab[]
  active: string | null
  // Counts connections to the agent: shells opened under an earlier one are gone.
  session: number
}

const projectKeys = ['conn', 'tabs', 'active', 'session'] as const
type ProjectFields = Pick<Project, (typeof projectKeys)[number]>

function blankProject(id: string): Project {
  return { id, conn: { state: 'idle' }, tabs: [], active: null, session: 0 }
}

// The current project's fields are also at the top of the state (conn, tabs, active, ...), so
// most of the app works on "the" project; projects holds every project, the current one kept
// in step with them.
export type State = {
  platform: string
  settings: Settings
  project: string
  projects: Project[]
  conn: Connection
  tabs: Tab[]
  active: string | null
  palette: null | { mode: 'commands' | 'themes'; text?: string }
  search: null | { kind: 'files' | 'text'; text: string }
  status: Record<string, PaneStatus>
  // Previewing a theme in the picker, without saving it.
  previewTheme: string | null
  session: number
}

// newId never makes w0.
const first = blankProject('w0')

let state: State = {
  platform: 'darwin',
  settings: defaultSettings,
  project: first.id,
  projects: [first],
  conn: { state: 'idle' },
  tabs: [],
  active: null,
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
  const next = { ...state, ...patch }
  if (projectKeys.some((k) => k in patch)) {
    const fields: ProjectFields = { conn: next.conn, tabs: next.tabs, active: next.active, session: next.session }
    next.projects = next.projects.map((p) => (p.id === next.project ? { ...p, ...fields } : p))
  }
  state = next
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

// A tab can be in a project other than the current one (a file saved after switching away).
export function updateTab(id: string, patch: Partial<Tab>) {
  const pid = projectOfTab(id) ?? state.project
  setProject(pid, (p) => ({ tabs: p.tabs.map((t) => (t.id === id ? ({ ...t, ...patch } as Tab) : t)) }))
}

export function project(id: string): Project | undefined {
  return state.projects.find((p) => p.id === id)
}

export function currentProject(): Project {
  return project(state.project)!
}

export function setProject(id: string, update: Partial<ProjectFields> | ((p: Project) => Partial<ProjectFields>)) {
  const p = project(id)
  if (!p) return
  const patch = typeof update === 'function' ? update(p) : update
  if (id === state.project) set(patch)
  else set((s) => ({ projects: s.projects.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
}

// The project a tab (or a terminal split off one) is in.
export function projectOfTab(id: string): string | undefined {
  return state.projects.find((p) => p.tabs.some((t) => t.id === id || t.splits?.panes.includes(id)))?.id
}

export function switchProject(id: string) {
  const p = project(id)
  if (!p || id === state.project) return
  set({ project: id, conn: p.conn, tabs: p.tabs, active: p.active, session: p.session, palette: null, search: null })
}

// A new project after the others, made current (it starts on the connect screen).
export function addProject(): string {
  const p = blankProject(newId('w'))
  set((s) => ({ projects: [...s.projects, p] }))
  switchProject(p.id)
  return p.id
}

// Drops a project; when it's the current one, the one before it (or after, for the first)
// becomes current. The last project is replaced by a new one.
export function removeProject(id: string) {
  const i = state.projects.findIndex((p) => p.id === id)
  if (i < 0) return
  if (state.projects.length === 1) {
    const p = blankProject(newId('w'))
    set({ projects: [p], project: p.id, ...fieldsOf(p), palette: null, search: null, status: {} })
    return
  }
  if (id === state.project) switchProject(state.projects[i === 0 ? 1 : i - 1].id)
  set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }))
}

function fieldsOf(p: Project): ProjectFields {
  return { conn: p.conn, tabs: p.tabs, active: p.active, session: p.session }
}

export function isConnected(c: Connection): c is Extract<Connection, { state: 'connected' | 'lost' }> {
  return c.state === 'connected' || c.state === 'lost'
}

// The project a component is in (its panes are rendered under a provider), so its calls go to
// that project's agent even when another project is current.
// What useProject sees of a project that was just removed (while its panes unmount).
const gone = blankProject('')

export const ProjectContext = createContext('')

export function useProjectId(): string {
  return useContext(ProjectContext) || state.project
}

export function useProject<T>(selector: (p: Project) => T): T {
  const id = useProjectId()
  return useStore((s) => selector(s.projects.find((p) => p.id === id) ?? gone))
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
