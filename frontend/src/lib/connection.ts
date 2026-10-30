// Connecting to a container: starting the agent there, and noticing when it goes away.
import { agent } from './agent'
import { errorText, invoke, on } from './bridge'
import { choose } from './dialogs'
import { dirtyCount, openWelcome, saveAll } from './actions'
import { updateSettings } from './settings'
import * as S from './store'

let listening = false
let attempt = 0

function listen() {
  if (listening) return
  listening = true
  on('agent:status', (status: string) => {
    const c = S.get().conn
    if (c.state === 'connecting') S.set({ conn: { ...c, status } })
  })
  on('agent:closed', (error: string) => {
    const c = S.get().conn
    if (c.state !== 'connected') return
    S.set({ conn: { state: 'lost', hello: c.hello, target: c.target, error: error || 'disconnected' } })
    // One quiet try straight away: a blip in the network shouldn't need a click.
    if (attempt === 0) {
      attempt++
      setTimeout(() => reconnect(), 1000)
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

export async function connect(target: S.Target) {
  listen()
  S.set({ conn: { state: 'connecting', status: 'Connecting…', target } })
  try {
    await invoke('Connect', target)
    const hello = await agent.hello(target.folder || undefined)
    attempt = 0
    S.set((s) => ({ conn: { state: 'connected', hello, target }, session: s.session + 1 }))
    remember({ ...target, folder: target.folder || hello.root })
    if (S.get().tabs.length === 0) openWelcome()
  } catch (err) {
    invoke('Disconnect').catch(() => {})
    S.set({ conn: { state: 'idle', error: errorText(err) } })
  }
}

// Back to the same container after the connection dropped, keeping the open tabs (their
// unsaved changes too). Terminals start new shells when next typed in.
export async function reconnect() {
  const c = S.get().conn
  if (c.state !== 'lost' || c.reconnecting) return
  S.set({ conn: { ...c, reconnecting: true } })
  try {
    await invoke('Connect', c.target)
    const hello = await agent.hello(c.hello.root)
    attempt = 0
    S.set((s) => ({ conn: { state: 'connected', hello, target: c.target }, session: s.session + 1 }))
  } catch (err) {
    const now = S.get().conn
    if (now.state === 'lost') S.set({ conn: { ...now, reconnecting: false, error: errorText(err) } })
  }
}

// Back to the connect screen. Closes everything, so unsaved changes are asked about first.
export async function disconnect() {
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
  await invoke('Disconnect').catch(() => {})
  S.set({ conn: { state: 'idle' }, tabs: [], active: null, explorer: false, palette: null, search: null, status: {} })
}
