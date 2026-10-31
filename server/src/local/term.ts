// Shells on this computer, on a pseudo-terminal: the term.* methods (see internal/agent/term.go).
// Output streams back as term.data events, and term.exit when the shell ends. The pseudo-terminal
// is Bun's own on macOS and Linux, and ConPTY through node-pty on Windows, where Bun has none.
import { existsSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import { expandHome, fromWire, isWindows, lookPath, toWire } from '../wire.ts'

type Emit = (event: string, params: unknown) => void

// A shell on a pseudo-terminal.
type Pty = {
  pid: number
  write(data: Uint8Array): void
  resize(cols: number, rows: number): void
  kill(signal?: NodeJS.Signals): void
}

type Spawn = {
  shell: string
  args: string[]
  cols: number
  rows: number
  cwd: string
  env: Record<string, string | undefined>
  onData(data: Uint8Array): void
  onExit(code: number): void
}

function spawnBun(o: Spawn): Pty {
  const proc = Bun.spawn([o.shell, ...o.args], {
    cwd: o.cwd,
    env: o.env,
    terminal: { cols: o.cols, rows: o.rows, name: 'xterm-256color', data: (_t, data) => o.onData(data) },
  })
  const term = proc.terminal!
  proc.exited.then((code) => {
    term.close()
    o.onExit(code)
  })
  return {
    pid: proc.pid,
    write: (data) => term.write(data),
    resize: (cols, rows) => term.resize(cols, rows),
    kill: (signal) => proc.kill(signal),
  }
}

async function spawnNodePty(o: Spawn): Promise<Pty> {
  // Loaded on first use, so a missing native module only breaks terminals.
  const pty = await import('@lydell/node-pty')
  const term = pty.spawn(o.shell, o.args, { name: 'xterm-256color', cols: o.cols, rows: o.rows, cwd: o.cwd, env: o.env })
  term.onData((data) => o.onData(Buffer.from(data, 'utf8')))
  term.onExit(({ exitCode }) => {
    // The ConPTY output worker outlives the shell until it's killed.
    try {
      term.kill()
    } catch {
      // Already released.
    }
    o.onExit(exitCode)
  })
  return {
    pid: term.pid,
    write: (data) => term.write(Buffer.from(data)),
    resize: (cols, rows) => term.resize(cols, rows),
    kill: (signal) => term.kill(signal),
  }
}

// Windows: PowerShell 7 if it's installed, else Windows PowerShell, else cmd. Elsewhere the
// user's login shell, started as one (-l) so it gets their prompt and profile.
function shellCommand(): [string, string[]] {
  if (isWindows) {
    for (const name of ['pwsh.exe', 'powershell.exe']) {
      const p = lookPath(name)
      if (p) return [p, ['-NoLogo']]
    }
    return [process.env.COMSPEC || 'cmd.exe', []]
  }
  return [loginShell(), ['-l']]
}

// $SHELL, else the user's /etc/passwd entry, else zsh on macOS, bash or sh elsewhere.
export function loginShell(): string {
  if (isWindows) return shellCommand()[0]
  if (process.env.SHELL) return process.env.SHELL
  try {
    const uid = String(process.getuid?.())
    for (const line of readFileSync('/etc/passwd', 'utf8').split('\n')) {
      const f = line.split(':')
      if (f.length >= 7 && f[2] === uid && f[6] && existsSync(f[6])) return f[6]
    }
  } catch {
    // No passwd file: fall through to the usual shells.
  }
  const candidates = ['/bin/bash', '/usr/bin/bash', '/bin/sh']
  if (process.platform === 'darwin') candidates.unshift('/bin/zsh')
  return candidates.find((s) => existsSync(s)) ?? 'sh'
}

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

export class Terminals {
  private all = new Map<string, Pty>()
  private next = 0
  private emit: Emit

  constructor(emit: Emit) {
    this.emit = emit
  }

  private get(id: string): Pty {
    const t = this.all.get(id)
    if (!t) throw new Error(`no terminal ${id}`)
    return t
  }

  async open(p: { cols?: number; rows?: number; cwd?: string }) {
    const [shell, args] = shellCommand()
    const cwd = expandHome(fromWire(p.cwd || ''))
    const id = String(++this.next)
    const o: Spawn = {
      shell,
      args,
      cols: Math.max(p.cols || 0, 20),
      rows: Math.max(p.rows || 0, 5),
      cwd: cwd && isDir(cwd) ? cwd : os.homedir(),
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', SHELL: shell, TERM_PROGRAM: 'monomyth' },
      onData: (data) => this.emit('term.data', { id, data: Buffer.from(data).toString('base64') }),
      // Let the last output through before the pane closes.
      onExit: (code) =>
        setTimeout(() => {
          this.all.delete(id)
          this.emit('term.exit', { id, code })
        }, 100),
    }
    this.all.set(id, isWindows ? await spawnNodePty(o) : spawnBun(o))
    return { id, shell: toWire(shell) }
  }

  input(p: { id: string; data: string }) {
    this.get(p.id).write(Buffer.from(p.data, 'base64'))
    return {}
  }

  resize(p: { id: string; cols?: number; rows?: number }) {
    this.get(p.id).resize(Math.max(p.cols || 0, 2), Math.max(p.rows || 0, 1))
    return {}
  }

  // Hang up on the shell, as closing a terminal window does: on Unix its whole process group.
  close(p: { id: string }) {
    const t = this.all.get(p.id)
    if (!t) return {}
    if (isWindows) {
      t.kill()
    } else {
      try {
        process.kill(-t.pid, 'SIGHUP')
      } catch {
        // Not a group leader, or already gone.
      }
      t.kill('SIGHUP')
    }
    return {}
  }

  closeAll() {
    for (const id of [...this.all.keys()]) {
      try {
        this.close({ id })
      } catch {
        // Already exiting.
      }
    }
  }
}
