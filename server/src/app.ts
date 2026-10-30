// What the window calls: settings, picking a container, and a connection to the agent, either
// the local one in this process or the one in a container. Events go to the window through
// emit.
import { promises as fs, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LocalAgent } from './local/agent.ts'
import { AgentProcess, Oc, type Target } from './remote.ts'
import { fromWindowsPath, isWindows, isWsl, run, toWire } from './wire.ts'

type Emit = (event: string, data: unknown) => void

interface Connection {
  call(method: string, params: string): Promise<string>
  close(): Promise<void>
}

// Settings and recent connections, in the user's config folder.
function settingsPath(): string {
  const home = os.homedir()
  const dir = isWindows
    ? process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
    : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : process.env.XDG_CONFIG_HOME || path.join(home, '.config')
  return path.join(dir, 'monomyth', 'settings.json')
}

const isJSON = (s: string) => {
  try {
    JSON.parse(s)
    return true
  } catch {
    return false
  }
}

export class App {
  // An agent binary to run on this machine as a pretend pod, to try the container path
  // without a cluster (development).
  localAgent = ''
  settingsPath = settingsPath()

  private emit: Emit
  private clients = new Map<string, Connection>()
  // Connections being started, so a Disconnect meanwhile can call them off.
  private starting = new Map<string, symbol>()

  constructor(emit: Emit) {
    this.emit = emit
  }

  // The saved settings as JSON (the window owns their shape), or "{}".
  Settings(): string {
    try {
      const data = readFileSync(this.settingsPath, 'utf8')
      return isJSON(data) ? data : '{}'
    } catch {
      return '{}'
    }
  }

  // The user's own themes: the .json files in the themes folder next to the settings (the
  // window checks their contents). No folder means none.
  async Themes(): Promise<{ file: string; text: string }[]> {
    const dir = path.join(path.dirname(this.settingsPath), 'themes')
    const names = await fs.readdir(dir).catch(() => [] as string[])
    const files = names.filter((n) => n.toLowerCase().endsWith('.json')).sort()
    const out = await Promise.all(files.map(async (file) => ({ file, text: await fs.readFile(path.join(dir, file), 'utf8').catch(() => '') })))
    return out.filter((t) => t.text)
  }

  async SaveSettings(data: string) {
    if (typeof data !== 'string' || !isJSON(data)) throw new Error("settings aren't valid JSON")
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true })
    const tmp = this.settingsPath + '.tmp'
    await fs.writeFile(tmp, data)
    await fs.rename(tmp, this.settingsPath)
  }

  private oc(): Oc {
    let ocPath = ''
    try {
      ocPath = JSON.parse(this.Settings()).ocPath || ''
    } catch {
      // No settings.
    }
    return new Oc(ocPath)
  }

  // As Go names it, which the window expects.
  Platform(): string {
    return isWindows ? 'windows' : process.platform
  }

  async OcProjects() {
    if (this.localAgent) return { names: ['local'], current: 'local' }
    return this.oc().projects()
  }

  async OcPods(project: string) {
    if (this.localAgent) return [{ name: os.hostname(), workspace: 'this machine', containers: ['local'], ready: true }]
    return this.oc().pods(project)
  }

  // Starts the agent for a connection id (one per project in the window), replacing any
  // earlier connection with that id. Progress comes as agent:status events, the agent's events
  // as agent:event, and a dropped connection as agent:closed, each with the connection id.
  async Connect(t: Target, id = '') {
    await this.Disconnect(id)
    const token = Symbol(id)
    this.starting.set(id, token)
    const onEvent = (event: string, params: unknown) => this.emit('agent:event', { conn: id, event, params })
    const status = (s: string) => this.emit('agent:status', { conn: id, status: s })
    let mine: Connection | undefined
    const onClose = (reason: string) => {
      if (mine && this.clients.get(id) === mine) {
        this.clients.delete(id)
        this.emit('agent:closed', { conn: id, error: reason })
      }
    }
    try {
      if (t?.local) {
        status('Opening…')
        mine = new LocalAgent(onEvent)
      } else if (this.localAgent) {
        status('Starting…')
        mine = new AgentProcess(this.localAgent, [], onEvent, onClose)
      } else {
        mine = await this.oc().connect(t, status, onEvent, onClose)
      }
    } finally {
      if (this.starting.get(id) === token) this.starting.delete(id)
      else if (mine) {
        // Disconnected (or connected again) while starting: this one isn't wanted.
        const unwanted = mine
        mine = undefined
        await unwanted.close()
      }
    }
    if (!mine) throw new Error('disconnected')
    this.clients.set(id, mine)
  }

  async Disconnect(id = '') {
    this.starting.delete(id)
    const c = this.clients.get(id)
    this.clients.delete(id)
    await c?.close()
  }

  async DisconnectAll() {
    await Promise.all([...this.clients.keys()].map((id) => this.Disconnect(id)))
  }

  // Sends a request to a connection's agent; params and the result are JSON.
  async Call(method: string, params: string, id = ''): Promise<string> {
    const c = this.clients.get(id)
    if (!c) throw new Error('not connected')
    return c.call(method, params || 'null')
  }

  // Asks for a folder on this computer with the system's picker. An empty result means it was
  // cancelled.
  async PickFolder(): Promise<string> {
    if (isWindows || isWsl) {
      const script = [
        '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
        'Add-Type -AssemblyName System.Windows.Forms',
        '$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }',
        '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
        "$d.Description = 'Open a folder'",
        "if ($d.ShowDialog($owner) -eq 'OK') { $d.SelectedPath }",
      ].join('; ')
      const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script])
      if (!r.ok) throw new Error(r.stderr.trim() || 'the folder picker failed')
      const picked = r.stdout.toString('utf8').trim()
      // Under WSL the picker is Windows' own; its C:\... answer is a /mnt/c/... path here.
      return picked && isWsl ? fromWindowsPath(picked) : toWire(picked)
    }
    if (process.platform === 'darwin') {
      const r = await run('osascript', ['-e', 'POSIX path of (choose folder with prompt "Open a folder")'])
      if (!r.ok) return '' // cancelled
      return r.stdout.toString('utf8').trim().replace(/(.)\/$/, '$1')
    }
    const r = await run('zenity', ['--file-selection', '--directory'])
    if (r.ok) return r.stdout.toString('utf8').trim()
    if (r.code === 1) return '' // cancelled
    throw new Error("there's no folder picker here; type the folder's path")
  }
}
