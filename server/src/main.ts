// The backend for running Monomyth in a browser: serves the app's methods (see app.ts) over
// HTTP, which Vite's dev server proxies /api to.
//
//   node server/src/main.ts [--addr 127.0.0.1:34115] [--agent path/to/agent]
//
// POST /api/<Method> with a JSON array of arguments returns the result as JSON (or an error
// with status 500); GET /api/events streams the app's events. --agent runs an agent binary on
// this machine as a pretend pod, to try the container path without a cluster.
import http from 'node:http'
import { parseArgs } from 'node:util'
import { App } from './app.ts'
import { Sql } from './sql/index.ts'

const { values: flags } = parseArgs({
  options: { addr: { type: 'string', default: '127.0.0.1:34115' }, agent: { type: 'string', default: '' } },
})
const at = flags.addr.lastIndexOf(':')
const host = flags.addr.slice(0, at) || '127.0.0.1'
const port = Number(flags.addr.slice(at + 1))

const subscribers = new Set<http.ServerResponse>()
const app = new App((event, data) => {
  const msg = `data: ${JSON.stringify({ event, data: data ?? null })}\n\n`
  for (const res of subscribers) res.write(msg)
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
  SetDirty: () => app.SetDirty(),
  Quit: () => app.Quit(),
  // SQL tabs' databases, reached from this computer.
  SqlConnect: ([id, config]) => sql.connect(String(id ?? ''), config),
  SqlQuery: ([id, text]) => sql.query(String(id ?? ''), String(text ?? '')),
  SqlCancel: ([id]) => sql.cancel(String(id ?? '')),
  SqlTables: ([id]) => sql.tables(String(id ?? '')),
  SqlColumns: ([id, schema, table]) => sql.columns(String(id ?? ''), schema, table),
  SqlDisconnect: ([id]) => sql.disconnect(String(id ?? '')),
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

server.listen(port, host, () => console.log(`monomyth server on http://${flags.addr}`))

// Hang up the shells before exiting.
const stop = async () => {
  await Promise.all([app.DisconnectAll().catch(() => {}), sql.closeAll().catch(() => {})])
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
