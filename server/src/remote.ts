// Containers through the OpenShift CLI: listing projects and pods, uploading the agent (the Go
// binary built into internal/remote/agentbin by `go run ./scripts/buildagent`) and talking
// to it over `oc exec`'s stdin and stdout. See internal/remote, which the desktop app uses.
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { isWindows, lookPath, run } from './wire.ts'

const agentDir = fileURLToPath(new URL('../../internal/remote/agentbin/', import.meta.url))

// The agent for a container architecture (as `uname -m` prints it), and a short hash of it
// that names the uploaded copy, so a new build is uploaded once and reused after.
function agentFor(machine: string): { data: Buffer; hash: string } {
  const arch = ({ x86_64: 'amd64', amd64: 'amd64', aarch64: 'arm64', arm64: 'arm64' } as Record<string, string>)[machine]
  if (!arch) throw new Error(`containers on ${machine} aren't supported`)
  let data: Buffer
  try {
    data = readFileSync(path.join(agentDir, 'agent-linux-' + arch))
  } catch {
    throw new Error(`there's no agent for linux/${arch}; run \`go run ./scripts/buildagent\` once, then try again`)
  }
  return { data, hash: createHash('sha256').update(data).digest('hex').slice(0, 12) }
}

export type Projects = { names: string[]; current: string }
export type Pod = { name: string; workspace?: string; containers: string[]; ready: boolean }

// Where to connect: a container (project, pod, container), or this computer (local). folder
// is the folder to open, or empty for the default.
export type Target = { local?: boolean; project: string; pod: string; container: string; folder: string }

const execArgs = (t: Target, ...cmd: string[]) => [
  'exec', '-i', '-n', t.project, t.pod, ...(t.container ? ['-c', t.container] : []), '--', ...cmd,
]

// Picks a folder the agent can live in: the user's cache folder, else one in /tmp. Prints the
// architecture, the folder, and which of the given agent hashes are already there.
const probeScript = `
m=$(uname -m)
d="\${XDG_CACHE_HOME:-\${HOME:-/tmp}/.cache}/monomyth-agent"
if ! mkdir -p "$d" 2>/dev/null || [ ! -w "$d" ]; then d="/tmp/monomyth-agent-$(id -u)"; mkdir -p "$d" || exit 1; fi
echo "$m"
echo "$d"
for h in "$@"; do [ -x "$d/agent-$h" ] && echo "have $h"; done
exit 0
`

const uploadScript = `
d="$1"; f="$d/agent-$2"; t="$d/.agent-$2.$$"
cat > "$t" && chmod 755 "$t" && mv -f "$t" "$f"
`

// Runs the OpenShift CLI. ocPath comes from settings; when it's empty, oc is looked for on
// PATH and where it's usually installed.
export class Oc {
  private ocPath: string

  constructor(ocPath = '') {
    this.ocPath = ocPath
  }

  bin(): string {
    if (this.ocPath) return this.ocPath
    const found = lookPath('oc')
    if (found) return found
    const home = os.homedir()
    const name = isWindows ? 'oc.exe' : 'oc'
    const dirs = isWindows
      ? [path.join(home, 'bin'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'oc'), 'C:\\Program Files\\oc', 'C:\\oc']
      : ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, 'bin'), path.join(home, '.local', 'bin')]
    for (const d of dirs) {
      const p = path.join(d, name)
      try {
        if (statSync(p).isFile()) return p
      } catch {
        // Not there.
      }
    }
    throw new Error("couldn't find the oc command; install it, or set its path in settings")
  }

  // oc's output, or its error message.
  async run(args: string[], input?: Buffer): Promise<string> {
    const r = await run(this.bin(), args, { input })
    if (!r.ok) {
      let msg = r.stderr.trim() || `oc exited with code ${r.code}`
      if (msg.includes('Unauthorized') || msg.includes('must be logged in')) {
        msg = 'oc isn\'t logged in. Run `oc login` in a terminal, then try again.\n' + msg
      }
      throw new Error(msg)
    }
    return r.stdout.toString('utf8')
  }

  async projects(): Promise<Projects> {
    const p: Projects = { names: [], current: '' }
    let err: unknown
    let out = ''
    try {
      out = await this.run(['get', 'projects', '-o', 'jsonpath={.items[*].metadata.name}'])
    } catch {
      // Plain Kubernetes, or not allowed to list projects: the current one still works.
      try {
        out = await this.run(['get', 'namespaces', '-o', 'jsonpath={.items[*].metadata.name}'])
      } catch (e) {
        err = e
      }
    }
    p.names = out.split(/\s+/).filter(Boolean)
    try {
      p.current = (await this.run(['project', '-q'])).trim()
    } catch {
      // No current project.
    }
    if (!p.names.length && !p.current) throw err ?? new Error('no projects found')
    p.names.sort()
    return p
  }

  // Running pods in a project. Dev Spaces workspaces are labelled with their workspace name.
  async pods(project: string): Promise<Pod[]> {
    const list = JSON.parse(await this.run(['get', 'pods', '-n', project, '-o', 'json']))
    const pods: Pod[] = []
    for (const item of list.items ?? []) {
      if (item.status?.phase !== 'Running') continue
      const pod: Pod = {
        name: item.metadata.name,
        containers: (item.spec?.containers ?? []).map((c: { name: string }) => c.name),
        ready: (item.status?.conditions ?? []).some((c: { type: string; status: string }) => c.type === 'Ready' && c.status === 'True'),
      }
      const workspace = item.metadata.labels?.['controller.devfile.io/devworkspace_name']
      if (workspace) pod.workspace = workspace
      pods.push(pod)
    }
    return pods.sort((a, b) => (!!a.workspace !== !!b.workspace ? (a.workspace ? -1 : 1) : a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }

  // Starts the agent in the container, uploading it first if this version isn't there yet.
  // status reports progress.
  async connect(t: Target, status: (s: string) => void, onEvent: OnEvent, onClose: (reason: string) => void): Promise<AgentProcess> {
    if (!t.project || !t.pod) throw new Error('pick a project and a pod')
    const hashes: string[] = []
    for (const m of ['x86_64', 'aarch64']) {
      try {
        hashes.push(agentFor(m).hash)
      } catch {
        // Not built for this architecture.
      }
    }
    status('Checking the container…')
    const out = await this.run(execArgs(t, 'sh', '-c', probeScript, 'sh', ...hashes))
    const lines = out.trim().split('\n')
    if (lines.length < 2) throw new Error(`unexpected reply from the container: ${JSON.stringify(out)}`)
    const machine = lines[0].trim()
    const dir = lines[1].trim()
    const have = new Set(lines.slice(2).map((l) => l.trim().replace(/^have /, '')))
    const { data, hash } = agentFor(machine)
    if (!have.has(hash)) {
      status(`Uploading the agent (${Math.floor(data.length / 1024)} KB)…`)
      try {
        await this.run(execArgs(t, 'sh', '-c', uploadScript, 'sh', dir, hash), data)
      } catch (e) {
        throw new Error('uploading the agent: ' + (e as Error).message)
      }
    }
    status('Starting…')
    return new AgentProcess(this.bin(), execArgs(t, `${dir}/agent-${hash}`), onEvent, onClose)
  }
}

type OnEvent = (event: string, params: unknown) => void

type Message = { id?: number; method?: string; params?: unknown; result?: unknown; error?: string; event?: string }

// An agent running as a process, spoken to over its stdin and stdout: one JSON message per
// line each way (see internal/proto).
export class AgentProcess {
  private child: ChildProcess
  private next = 0
  private pending = new Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>()
  private closed: Error | undefined
  private stderr = ''
  private done: Promise<void>

  constructor(bin: string, args: string[], onEvent: OnEvent, onClose: (reason: string) => void) {
    this.child = spawn(bin, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stdin!.on('error', () => {})
    // The last few KB of stderr (oc's errors land there), to explain a dropped connection.
    this.child.stderr!.on('data', (d: Buffer) => (this.stderr = (this.stderr + d.toString()).slice(-4096)))
    const lines = createInterface({ input: this.child.stdout!, crlfDelay: Infinity })
    lines.on('line', (line) => {
      let msg: Message
      try {
        msg = JSON.parse(line)
      } catch {
        return
      }
      if (msg.event) {
        onEvent(msg.event, msg.params ?? null)
        return
      }
      const waiter = this.pending.get(msg.id!)
      if (!waiter) return
      this.pending.delete(msg.id!)
      if (msg.error) waiter.reject(new Error(msg.error))
      else waiter.resolve(JSON.stringify(msg.result ?? null))
    })
    let spawnError = ''
    this.child.on('error', (e) => (spawnError = e.message))
    this.done = new Promise((resolve) => {
      this.child.on('close', (code) => {
        const err = this.stderr.trim()
        const reason = err ? err.split('\n').slice(-3).join('\n') : spawnError || (code ? `exit status ${code}` : 'disconnected')
        this.closed = new Error(reason)
        for (const w of this.pending.values()) w.reject(this.closed)
        this.pending.clear()
        resolve()
        onClose(reason)
      })
    })
  }

  // Sends a request and waits for its answer. params and the result are JSON.
  call(method: string, params: string): Promise<string> {
    if (this.closed) return Promise.reject(this.closed)
    const id = ++this.next
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      const line = JSON.stringify({ id, method, params: JSON.parse(params || 'null') }) + '\n'
      this.child.stdin!.write(line, (err) => {
        if (err && this.pending.delete(id)) reject(new Error('disconnected'))
      })
    })
  }

  // Closing its stdin makes the agent exit (and hang up its shells); it's killed if that takes
  // too long.
  async close() {
    this.child.stdin!.end()
    const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 3000).unref())
    if ((await Promise.race([this.done, timeout])) === 'timeout') this.child.kill()
  }
}
