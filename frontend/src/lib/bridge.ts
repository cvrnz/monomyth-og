// The way to the backend: the server (server/) over HTTP, with events over server-sent
// events.

type Listener = (data: any) => void

const listeners = new Map<string, Set<Listener>>()
let source: EventSource | undefined

function serverEvents() {
  if (source) return
  source = new EventSource('/api/events')
  source.onmessage = (e) => {
    const { event, data } = JSON.parse(e.data)
    listeners.get(event)?.forEach((fn) => fn(data))
  }
}

export async function invoke<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
  const res = await fetch(`/api/${method}`, { method: 'POST', body: JSON.stringify(args) })
  if (!res.ok) throw new Error((await res.text()).trim())
  return res.json()
}

// A call that still goes through while the page is closing (the browser drops ordinary
// requests then). Nothing comes back.
export function invokeOnExit(method: string, ...args: unknown[]) {
  fetch(`/api/${method}`, { method: 'POST', body: JSON.stringify(args), keepalive: true }).catch(() => {})
}

export function on(event: string, fn: Listener): () => void {
  serverEvents()
  let set = listeners.get(event)
  if (!set) listeners.set(event, (set = new Set()))
  set.add(fn)
  return () => set.delete(fn)
}

// The system clipboard.
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Copying is best effort.
  }
}

export async function pasteText(): Promise<string> {
  try {
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
