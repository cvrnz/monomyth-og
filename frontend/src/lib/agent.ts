// Typed calls to the agent in the container (see agent/*.go for what each does).
import { invoke, on } from './bridge'

async function call<T>(method: string, params: unknown = {}): Promise<T> {
  const out = await invoke<string>('Call', method, JSON.stringify(params))
  return JSON.parse(out) as T
}

export type Hello = { hostname: string; user: string; home: string; root: string; shell: string }
export type Entry = { name: string; dir: boolean; link: boolean; size: number }
export type ReadResult = { content: string; binary: boolean; tooLarge: boolean; size: number }
export type Change = { status: string; path: string; old?: string }
export type SyncAction = { label: string; verb: string; done: string; dim?: boolean }
export type Repo = {
  path: string
  name: string
  branch: string
  sync: { ahead: number; behind: number } | null
  arrows: string
  remote: string
  count: number
  action: SyncAction | null
}
export type Version = { content: string; binary: boolean }
export type Match = { path: string; line: number; col: number; text: string }

export const agent = {
  hello: (root?: string) => call<Hello>('hello', { root }),
  list: (path: string) => call<Entry[]>('fs.list', { path }),
  read: (path: string, limit?: number) => call<ReadResult>('fs.read', { path, limit }),
  write: (path: string, content: string) => call<void>('fs.write', { path, content }),
  create: (path: string, dir: boolean) => call<void>('fs.create', { path, dir }),
  rename: (from: string, to: string) => call<void>('fs.rename', { from, to }),
  remove: (path: string) => call<void>('fs.delete', { path }),
  stat: (path: string) => call<{ exists: boolean; dir: boolean }>('fs.stat', { path }),
  files: (root: string) => call<{ files: string[]; truncated: boolean }>('fs.files', { root }),
  grep: (root: string, query: string) => call<{ matches: Match[]; truncated: boolean }>('fs.grep', { root, query }),
  repos: (roots: string[]) => call<Repo[]>('scm.repos', { roots }),
  changes: (repo: string) => call<Change[]>('scm.changes', { repo }),
  versions: (repo: string, change: Change) => call<{ old: Version; new: Version }>('scm.versions', { repo, change }),
  fetch: (repo: string, name: string) => call<Repo>('scm.fetch', { repo, name }),
  sync: (repo: string) => call<void>('scm.sync', { repo }),
  termOpen: (cols: number, rows: number, cwd: string) => call<{ id: string; shell: string }>('term.open', { cols, rows, cwd }),
  termInput: (id: string, data: string) => call<void>('term.input', { id, data }),
  termResize: (id: string, cols: number, rows: number) => call<void>('term.resize', { id, cols, rows }),
  termClose: (id: string) => call<void>('term.close', { id }),
}

type AgentEvent = { event: string; params: any }
const handlers = new Map<string, Set<(params: any) => void>>()
let listening = false

// Events from the agent (terminal output and exits), by name.
export function onAgent(event: string, fn: (params: any) => void): () => void {
  if (!listening) {
    listening = true
    on('agent:event', (e: AgentEvent) => handlers.get(e.event)?.forEach((h) => h(e.params)))
  }
  let set = handlers.get(event)
  if (!set) handlers.set(event, (set = new Set()))
  set.add(fn)
  return () => set.delete(fn)
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
