// Helpers shared by the local agent and the oc side: wire paths, finding commands on PATH and
// running them.
import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const isWindows = process.platform === 'win32'

// Paths go over the wire with forward slashes on every OS (C:/Users/... on Windows).
export const toWire = (p: string) => (isWindows ? p.replaceAll('\\', '/') : p)
export const fromWire = (p: string) => (isWindows ? p.replaceAll('/', '\\') : p)

// Like Go's filepath.Clean: normalized, with no trailing separator except on a root.
export function clean(p: string): string {
  let c = path.normalize(p || '.')
  const root = path.parse(c).root
  while (c.length > root.length && (c.endsWith(path.sep) || c.endsWith('/'))) c = c.slice(0, -1)
  return c
}

export function expandHome(p: string): string {
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(1))
  return p
}

const isFile = (p: string) => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

// The full path of a command, as the shell would find it on PATH (with PATHEXT on Windows).
export function lookPath(name: string): string {
  if (name.includes('/') || name.includes('\\')) return isFile(name) ? name : ''
  const exts = isWindows ? ['', ...(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')] : ['']
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const p = path.join(dir, name + ext)
      if (isFile(p)) return p
    }
  }
  return ''
}

export type RunResult = { ok: boolean; code: number | null; stdout: Buffer; stderr: string }

export type RunOptions = { cwd?: string; env?: NodeJS.ProcessEnv; input?: Buffer; timeoutMs?: number }

// Runs a command to completion, without a console window on Windows. A command that can't
// start (not installed) is a failed result, not an exception.
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const out: Buffer[] = []
    const err: Buffer[] = []
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (e) {
      resolve({ ok: false, code: null, stdout: Buffer.alloc(0), stderr: String(e) })
      return
    }
    const timer = opts.timeoutMs ? setTimeout(() => child.kill(), opts.timeoutMs) : undefined
    child.stdout!.on('data', (d: Buffer) => out.push(d))
    child.stderr!.on('data', (d: Buffer) => err.push(d))
    child.stdin!.on('error', () => {})
    child.stdin!.end(opts.input)
    let done = false
    const finish = (code: number | null, failed: string) => {
      if (done) return
      done = true
      clearTimeout(timer)
      const stderr = Buffer.concat(err).toString() || failed
      resolve({ ok: code === 0 && !failed, code, stdout: Buffer.concat(out), stderr })
    }
    child.on('error', (e) => finish(null, e.message))
    child.on('close', (code) => finish(code, ''))
  })
}

// Text unless it has a NUL byte near the start, as git and the editor decide.
export const isBinary = (data: Buffer) => data.subarray(0, 8000).includes(0)
