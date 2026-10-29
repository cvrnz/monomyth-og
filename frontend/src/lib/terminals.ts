// Shells in the container, routed to their terminal panes. A shell can start printing before
// term.open has answered with its id, so output for an id nobody has claimed yet is held
// until its pane does.
import { agent, fromBase64, onAgent, toBase64 } from './agent'

type Sink = { data: (bytes: Uint8Array) => void; exit: (code: number) => void }

const sinks = new Map<string, Sink>()
const early = new Map<string, { data: Uint8Array[]; exit?: number }>()
let listening = false

function listen() {
  if (listening) return
  listening = true
  onAgent('term.data', (p: { id: string; data: string }) => {
    const bytes = fromBase64(p.data)
    const sink = sinks.get(p.id)
    if (sink) sink.data(bytes)
    else hold(p.id).data.push(bytes)
  })
  onAgent('term.exit', (p: { id: string; code: number }) => {
    const sink = sinks.get(p.id)
    if (sink) sink.exit(p.code)
    else hold(p.id).exit = p.code
  })
}

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

export async function openShell(cols: number, rows: number, cwd: string, sink: Sink): Promise<Shell> {
  listen()
  const { id, shell } = await agent.termOpen(cols, rows, cwd)
  sinks.set(id, sink)
  const held = early.get(id)
  if (held) {
    early.delete(id)
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
      sinks.delete(id)
      agent.termClose(id).catch(() => {})
    },
  }
}
