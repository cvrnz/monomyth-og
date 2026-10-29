// The way to the Go side. In the desktop app that's Wails' bindings (window.go) and events
// (window.runtime); in a browser running `pnpm dev`, it's cmd/devserver over HTTP.

type Listener = (data: any) => void

declare global {
  interface Window {
    go?: { app: { App: Record<string, (...args: any[]) => Promise<any>> } }
    runtime?: { EventsOn: (event: string, fn: Listener) => () => void }
  }
}

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
  const bound = window.go?.app?.App
  if (bound) {
    return bound[method](...args)
  }
  const res = await fetch(`/api/${method}`, { method: 'POST', body: JSON.stringify(args) })
  if (!res.ok) throw new Error((await res.text()).trim())
  return res.json()
}

export function on(event: string, fn: Listener): () => void {
  if (window.runtime) {
    return window.runtime.EventsOn(event, fn)
  }
  devEvents()
  let set = listeners.get(event)
  if (!set) listeners.set(event, (set = new Set()))
  set.add(fn)
  return () => set.delete(fn)
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
