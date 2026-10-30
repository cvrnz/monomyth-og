// Shells in the container, routed to their terminal panes. A shell can start printing before
// term.open has answered with its id, so output for an id nobody has claimed yet is held
// until its pane does. Shell ids are only unique per agent, so they're keyed by project too.
import { agentFor, fromBase64, onAgent, toBase64 } from './agent'
import * as S from './store'

type Sink = { data: (bytes: Uint8Array) => void; exit: (code: number) => void }

const sinks = new Map<string, Sink>()
const early = new Map<string, { data: Uint8Array[]; exit?: number }>()
let listening = false

function listen() {
  if (listening) return
  listening = true
  onAgent('term.data', (p: { id: string; data: string }, project) => {
    const bytes = fromBase64(p.data)
    const key = keyOf(project, p.id)
    const sink = sinks.get(key)
    if (sink) sink.data(bytes)
    else hold(key).data.push(bytes)
  })
  onAgent('term.exit', (p: { id: string; code: number }, project) => {
    const key = keyOf(project, p.id)
    const sink = sinks.get(key)
    if (sink) sink.exit(p.code)
    else hold(key).exit = p.code
  })
}

const keyOf = (project: string, id: string) => `${project}/${id}`

function hold(id: string) {
  let h = early.get(id)
  if (!h) early.set(id, (h = { data: [] }))
  return h
}

export type Shell = {
  id: string
  shell: string
  write(data: string): void
  // xterm's binary data: one byte per character
  writeBinary(data: string): void
  resize(cols: number, rows: number): void
  close(): void
}

const encoder = new TextEncoder()

export async function openShell(project: string, cols: number, rows: number, cwd: string, sink: Sink): Promise<Shell> {
  listen()
  const agent = agentFor(project)
  const { id, shell } = await agent.termOpen(cols, rows, cwd)
  const key = keyOf(project, id)
  sinks.set(key, sink)
  const held = early.get(key)
  if (held) {
    early.delete(key)
    held.data.forEach((d) => sink.data(d))
    if (held.exit !== undefined) sink.exit(held.exit)
  }
  // Calls can overtake each other on the way to the agent, so keystrokes go one batch at a
  // time: what's typed while one is in flight is sent together after it.
  let pending: Uint8Array[] = []
  let sending = false
  const flush = async () => {
    if (sending) return
    sending = true
    while (pending.length) {
      const chunks = pending
      pending = []
      const data = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
      let at = 0
      for (const c of chunks) {
        data.set(c, at)
        at += c.length
      }
      await agent.termInput(id, toBase64(data)).catch(() => {})
    }
    sending = false
  }
  return {
    id,
    shell,
    write: (data) => {
      pending.push(encoder.encode(data))
      flush()
    },
    writeBinary: (data) => {
      pending.push(Uint8Array.from(data, (c) => c.charCodeAt(0) & 255))
      flush()
    },
    resize: (c, r) => {
      agent.termResize(id, c, r).catch(() => {})
    },
    close: () => {
      sinks.delete(key)
      // A closed project's agent has hung up its shells already.
      if (S.project(project)) agent.termClose(id).catch(() => {})
    },
  }
}
