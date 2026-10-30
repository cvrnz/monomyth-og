// Connecting projects to their containers (or folders): starting each one's agent, and
// noticing when it goes away. Every project has its own connection, named by its id.
import { agentFor } from './agent'
import { errorText, invoke, on } from './bridge'
import { choose } from './dialogs'
import { dirtyCount, focusActive, saveAll } from './actions'
import { updateSettings } from './settings'
import * as S from './store'

let listening = false
// Quiet reconnect attempts since a project's connection last worked.
const attempts = new Map<string, number>()

function listen() {
  if (listening) return
  listening = true
  on('agent:status', ({ conn: id, status }: { conn: string; status: string }) => {
    S.setProject(id, (p) => (p.conn.state === 'connecting' ? { conn: { ...p.conn, status } } : {}))
  })
  on('agent:closed', ({ conn: id, error }: { conn: string; error: string }) => {
    const c = S.project(id)?.conn
    if (c?.state !== 'connected') return
    S.setProject(id, { conn: { state: 'lost', hello: c.hello, target: c.target, error: error || 'disconnected' } })
    // One quiet try straight away: a blip in the network shouldn't need a click.
    if (!attempts.get(id)) {
      attempts.set(id, 1)
      setTimeout(() => reconnect(id), 1000)
    }
  })
}

function sameTarget(a: S.Target, b: S.Target) {
  if (a.local || b.local) return Boolean(a.local && b.local) && a.folder === b.folder
  return a.project === b.project && a.container === b.container && a.folder === b.folder && (a.workspace ? a.workspace === b.workspace : a.pod === b.pod)
}

function remember(target: S.Target) {
  const recents = [target, ...S.get().settings.recents.filter((r) => !sameTarget(r, target))].slice(0, 8)
  updateSettings({ recents })
}

export function forget(target: S.Target) {
  updateSettings({ recents: S.get().settings.recents.filter((r) => !sameTarget(r, target)) })
}

// Connects a project (the current one unless given) and opens its welcome screen.
export async function connect(target: S.Target, id = S.get().project) {
  listen()
  S.setProject(id, { conn: { state: 'connecting', status: 'Connecting…', target } })
  try {
    await invoke('Connect', target, id)
    const hello = await agentFor(id).hello(target.folder || undefined)
    // Closed while connecting.
    if (!S.project(id)) {
      invoke('Disconnect', id).catch(() => {})
      return
    }
    attempts.delete(id)
    S.setProject(id, (p) => ({ conn: { state: 'connected', hello, target }, session: p.session + 1 }))
    remember({ ...target, folder: target.folder || hello.root })
    if (S.project(id)!.tabs.length === 0) {
      const welcome: S.WelcomeTab = { id: S.newId(), kind: 'welcome' }
      S.setProject(id, { tabs: [welcome], active: welcome.id, explorer: false })
      if (id === S.get().project) focusActive()
    }
  } catch (err) {
    invoke('Disconnect', id).catch(() => {})
    if (S.project(id)) S.setProject(id, { conn: { state: 'idle', error: errorText(err) } })
  }
}

// Back to the same container after the connection dropped, keeping the open tabs (their
// unsaved changes too). Terminals start new shells when next typed in.
export async function reconnect(id = S.get().project) {
  const c = S.project(id)?.conn
  if (c?.state !== 'lost' || c.reconnecting) return
  S.setProject(id, { conn: { ...c, reconnecting: true } })
  try {
    await invoke('Connect', c.target, id)
    const hello = await agentFor(id).hello(c.hello.root)
    attempts.delete(id)
    S.setProject(id, (p) => ({ conn: { state: 'connected', hello, target: c.target }, session: p.session + 1 }))
  } catch (err) {
    const now = S.project(id)?.conn
    if (now?.state === 'lost') S.setProject(id, { conn: { ...now, reconnecting: false, error: errorText(err) } })
  }
}

// A new project, on the connect screen, after the others.
export function newProject() {
  S.addProject()
}

// Closes the current project: its tabs and its connection (unsaved changes are asked about
// first). Another project becomes current, or the connect screen comes back.
export async function disconnect() {
  const id = S.get().project
  const n = dirtyCount()
  if (n > 0) {
    const choice = await choose(
      n === 1 ? 'Save changes to 1 file before disconnecting?' : `Save changes to ${n} files before disconnecting?`,
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
  closeProject(id)
}

// Drops a project without asking.
export function closeProject(id: string) {
  attempts.delete(id)
  S.removeProject(id)
  invoke('Disconnect', id).catch(() => {})
  focusActive()
}
