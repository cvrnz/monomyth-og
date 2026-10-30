// The way to the backend. In the desktop app that's the Wails v3 runtime: calls by name to the
// app service (internal/app.App) and its events. In a browser running `pnpm dev`, it's the
// Node server (server/) over HTTP, with events over server-sent events.
import { Call, Clipboard, Events } from '@wailsio/runtime'

type Listener = (data: any) => void

declare global {
  interface Window {
    chrome?: { webview?: { postMessage?: unknown } }
    webkit?: { messageHandlers?: Record<string, { postMessage?: unknown }> }
  }
}

// The same check the Wails runtime makes: a webview that can post to the Go side.
export const inWails = Boolean(window.chrome?.webview?.postMessage || window.webkit?.messageHandlers?.external?.postMessage)

const service = 'editor/internal/app.App'

const listeners = new Map<string, Set<Listener>>()
let source: EventSource | undefined

function devEvents() {
  if (source) return
  source = new EventSource('/api/events')
  source.onmessage = (e) => {
    const { event, data } = JSON.parse(e.data)
    listeners.get(event)?.forEach((fn) => fn(data))
  }
}

export async function invoke<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
  if (inWails) {
    return (await Call.ByName(`${service}.${method}`, ...args)) as T
  }
  const res = await fetch(`/api/${method}`, { method: 'POST', body: JSON.stringify(args) })
  if (!res.ok) throw new Error((await res.text()).trim())
  return res.json()
}

export function on(event: string, fn: Listener): () => void {
  if (inWails) {
    return Events.On(event, (ev) => fn(ev.data))
  }
  devEvents()
  let set = listeners.get(event)
  if (!set) listeners.set(event, (set = new Set()))
  set.add(fn)
  return () => set.delete(fn)
}

// The system clipboard. The webview's own clipboard API needs permissions it may not have,
// so the desktop app goes through Wails.
export async function copyText(text: string) {
  try {
    if (inWails) await Clipboard.SetText(text)
    else await navigator.clipboard.writeText(text)
  } catch {
    // Copying is best effort.
  }
}

export async function pasteText(): Promise<string> {
  try {
    if (inWails) return await Clipboard.Text()
    return await navigator.clipboard.readText()
  } catch {
    return ''
  }
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return String(err)
}
