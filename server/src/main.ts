// The backend: serves the app's methods (see app.ts) over HTTP. In development Vite's dev
// server proxies /api to it; in the macOS app (desktop/) it also serves the built page.
//
//   bun server/src/main.ts [--addr 127.0.0.1:34115] [--static frontend/dist] [--agent path/to/agent]
//
// POST /api/<Method> with a JSON array of arguments returns the result as JSON (or an error
// with status 500); GET /api/events streams the app's events. --static serves the page from
// that folder. --agent runs an agent binary on this machine as a pretend pod, to try the
// container path without a cluster. Port 0 picks a free one.
//
// Started by the macOS app, it talks to it over IPC: it sends { ready: port } once listening,
// { dirty } when unsaved changes come and go, and { quit: true } when the page agrees to quit;
// the app sends { event } for events to pass to the page (app:quit-requested).
import { createReadStream, statSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { App } from './app.ts'
import { Sql } from './sql/index.ts'

const { values: flags } = parseArgs({
  options: {
    addr: { type: 'string', default: '127.0.0.1:34115' },
    agent: { type: 'string', default: '' },
    static: { type: 'string', default: '' },
  },
})
const at = flags.addr.lastIndexOf(':')
const host = flags.addr.slice(0, at) || '127.0.0.1'
const port = Number(flags.addr.slice(at + 1))

const subscribers = new Set<http.ServerResponse>()
const emit = (event: string, data?: unknown) => {
  const msg = `data: ${JSON.stringify({ event, data: data ?? null })}\n\n`
  for (const res of subscribers) res.write(msg)
}
const app = new App(emit)
// The macOS app, when it started this server.
const desktop = process.send ? (msg: unknown) => process.send!(msg) : undefined
process.on('message', (msg: { event?: string }) => {
  if (msg?.event) emit(msg.event)
})
app.localAgent = flags.agent
const sql = new Sql()

const methods: Record<string, (args: any[]) => unknown> = {
  Settings: () => app.Settings(),
  SaveSettings: ([data]) => app.SaveSettings(data),
  Themes: () => app.Themes(),
  Platform: () => app.Platform(),
  OcProjects: () => app.OcProjects(),
  OcPods: ([project]) => app.OcPods(String(project ?? '')),
  Connect: ([target, id]) => app.Connect(target, String(id ?? '')),
  PickFolder: () => app.PickFolder(),
  Disconnect: ([id]) => app.Disconnect(String(id ?? '')),
  Call: ([method, params, id]) => app.Call(String(method ?? ''), String(params ?? ''), String(id ?? '')),
  // SQL tabs' databases, reached from this computer.
  SqlConnect: ([id, config]) => sql.connect(String(id ?? ''), config),
  SqlQuery: ([id, text]) => sql.query(String(id ?? ''), String(text ?? '')),
  SqlCancel: ([id]) => sql.cancel(String(id ?? '')),
  SqlTables: ([id]) => sql.tables(String(id ?? '')),
  SqlColumns: ([id, schema, table]) => sql.columns(String(id ?? ''), schema, table),
  SqlDisconnect: ([id]) => sql.disconnect(String(id ?? '')),
  // The macOS app asks before closing while anything is unsaved. Quit returns whether there's
  // an app to quit (in a browser there isn't).
  SetDirty: ([dirty]) => desktop?.({ dirty: Boolean(dirty) }),
  Quit: () => {
    desktop?.({ quit: true })
    return Boolean(desktop)
  },
}

// The built page, for the macOS app: files from --static, and index.html for anything else.
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

function serveStatic(pathname: string, res: http.ServerResponse) {
  const root = path.resolve(flags.static)
  let file = path.join(root, 'index.html')
  try {
    const want = path.join(root, decodeURIComponent(pathname))
    if (want.startsWith(root + path.sep) && statSync(want).isFile()) file = want
  } catch {
    // A malformed path: the page.
  }
  // Vite's hashed assets never change; everything else is checked each time.
  const cache = pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': cache })
  createReadStream(file).pipe(res)
}

// This server can read and write your files and run shells, so only this machine's pages may
// use it: other sites open in the browser (or ones pointing their DNS at 127.0.0.1) are refused.
const local = new Set(['127.0.0.1', 'localhost', '[::1]'])
const hostOf = (h: string) => (h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0])

function allowed(req: http.IncomingMessage): boolean {
  if (!local.has(hostOf(req.headers.host ?? ''))) return false
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return local.has(hostOf(new URL(origin).host))
  } catch {
    return false
  }
}

async function body(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const server = http.createServer(async (req, res) => {
  if (!allowed(req)) {
    res.writeHead(403).end('forbidden')
    return
  }
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    res.write(': hi\n\n')
    subscribers.add(res)
    req.on('close', () => subscribers.delete(res))
    return
  }
  if (flags.static && req.method === 'GET' && !url.pathname.startsWith('/api/')) {
    serveStatic(url.pathname, res)
    return
  }
  const fn = url.pathname.startsWith('/api/') && req.method === 'POST' ? methods[url.pathname.slice(5)] : undefined
  if (!fn) {
    res.writeHead(404).end('not found')
    return
  }
  try {
    let args: unknown = []
    try {
      args = JSON.parse((await body(req)) || '[]')
    } catch {
      // Treated as no arguments, as the Go server did.
    }
    const result = await fn(Array.isArray(args) ? args : [])
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result ?? null))
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(e instanceof Error ? e.message : String(e))
  }
})

server.listen(port, host, () => {
  const at = server.address()
  const bound = typeof at === 'object' && at ? at.port : port
  console.log(`monomyth server on http://${host}:${bound}`)
  desktop?.({ ready: bound })
})

// Hang up the shells before exiting.
const stop = async () => {
  await Promise.all([app.DisconnectAll().catch(() => {}), sql.closeAll().catch(() => {})])
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
// The macOS app went away.
if (desktop) process.on('disconnect', stop)
