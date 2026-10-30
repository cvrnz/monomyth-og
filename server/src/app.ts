// What the window calls: settings, picking a container, and a connection to the agent, either
// the local one in this process or the one in a container (see internal/app, the desktop
// app's version). Events go to the window through emit.
import { promises as fs, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LocalAgent } from './local/agent.ts'
import { AgentProcess, Oc, type Target } from './remote.ts'
import { isWindows, run, toWire } from './wire.ts'

type Emit = (event: string, data: unknown) => void

interface Connection {
  call(method: string, params: string): Promise<string>
  close(): Promise<void>
}

// The desktop app's settings file, so both share settings and recent connections.
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
  private client: Connection | undefined

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

  // Starts the agent, replacing any earlier connection. Progress comes as agent:status events,
  // the agent's events as agent:event, and a dropped connection as agent:closed.
  async Connect(t: Target) {
    await this.Disconnect()
    const onEvent = (event: string, params: unknown) => this.emit('agent:event', { event, params })
    const status = (s: string) => this.emit('agent:status', s)
    let mine: Connection | undefined
    const onClose = (reason: string) => {
      if (mine && this.client === mine) {
        this.client = undefined
        this.emit('agent:closed', reason)
      }
    }
    if (t?.local) {
      status('Opening…')
      mine = new LocalAgent(onEvent)
    } else if (this.localAgent) {
      status('Starting…')
      mine = new AgentProcess(this.localAgent, [], onEvent, onClose)
    } else {
      mine = await this.oc().connect(t, status, onEvent, onClose)
    }
    this.client = mine
  }

  async Disconnect() {
    const c = this.client
    this.client = undefined
    await c?.close()
  }

  // Sends a request to the agent; params and the result are JSON.
  async Call(method: string, params: string): Promise<string> {
    if (!this.client) throw new Error('not connected')
    return this.client.call(method, params || 'null')
  }

  // Asks for a folder on this computer with the system's picker. An empty result means it was
  // cancelled.
  async PickFolder(): Promise<string> {
    if (isWindows) {
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
      return toWire(r.stdout.toString('utf8').trim())
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

  // The desktop app asks about unsaved changes when its window closes; in a browser the page
  // asks itself (beforeunload), so these do nothing here.
  SetDirty() {}
  Quit() {}
}
