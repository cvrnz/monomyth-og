// Search for Cmd+F: file names and text inside files (see internal/agent/search.go). Both
// include hidden files, skip .git and respect .gitignore, like the nvim config's ripgrep
// searches. ripgrep is used when it's installed; otherwise git lists the files and they're
// searched here.
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { clean, fromWire, isBinary, lookPath, run, toWire } from '../wire.ts'
import { git, rootOf } from './git.ts'

const maxFiles = 100000
const maxMatches = 500
const maxLineColumns = 300
const maxGrepSize = 4 * 1024 * 1024

let rg: string | undefined
const rgPath = () => (rg ??= lookPath('rg'))

const splitLines = (s: string) => s.split(/\r?\n/).filter((l) => l !== '')

// Every file under the folder, relative to it.
export async function files(p: { root: string }) {
  const root = clean(fromWire(p.root))
  const rgBin = rgPath()
  if (rgBin) {
    const r = await run(rgBin, ['--files', '--hidden', '--glob', '!.git', '--no-messages'], { cwd: root, timeoutMs: 20000 })
    const list = splitLines(r.stdout.toString('utf8')).map(toWire)
    return list.length > maxFiles ? { files: list.slice(0, maxFiles), truncated: true } : { files: list, truncated: false }
  }
  const l = new Lister(root)
  await l.list(root, (await rootOf(root)) !== '')
  return { files: l.files, truncated: l.truncated }
}

const skipNames = new Set(['.git', 'node_modules', '.DS_Store'])

const isRepoTop = (dir: string) => fs.lstat(path.join(dir, '.git')).then(() => true, () => false)

class Lister {
  root: string
  files: string[] = []
  truncated = false

  constructor(root: string) {
    this.root = root
  }

  add(abs: string): boolean {
    if (this.files.length >= maxFiles) {
      this.truncated = true
      return false
    }
    this.files.push(toWire(path.relative(this.root, abs)))
    return true
  }

  // Lists a folder: through git when it's (inside) a repo, so ignored files are left out,
  // otherwise by reading it.
  async list(dir: string, inRepo: boolean): Promise<void> {
    if (this.truncated) return
    if (inRepo || (await isRepoTop(dir))) {
      const r = await git(dir, false, 'ls-files', '--cached', '--others', '--exclude-standard', '-z')
      if (r.ok) {
        for (const name of r.stdout.split('\0')) {
          if (!name) continue
          const abs = path.join(dir, fromWire(name))
          if (name.endsWith('/')) {
            // A repo inside this one, which git doesn't look into.
            await this.list(abs, false)
            continue
          }
          const info = await fs.lstat(abs).catch(() => undefined)
          if (!info) continue // tracked but deleted
          if (info.isDirectory()) {
            await this.list(abs, false) // a submodule
            continue
          }
          if (!this.add(abs)) return
        }
        return
      }
    }
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (skipNames.has(e.name)) continue
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) await this.list(abs, false)
      else if (!this.add(abs)) return
      if (this.truncated) return
    }
  }
}

type Match = { path: string; line: number; col: number; text: string }

const chars = (s: string) => Array.from(s).length

function clip(line: string): string {
  line = line.replace(/\r+$/, '')
  const cps = Array.from(line)
  return cps.length <= maxLineColumns ? line : cps.slice(0, maxLineColumns).join('')
}

// By path, then line: files finish in any order.
const sortMatches = (m: Match[]) => m.sort((a, b) => (a.path !== b.path ? (a.path < b.path ? -1 : 1) : a.line - b.line))

// Lines containing the text (case-insensitive unless it has capitals, like ripgrep's
// --smart-case), under the folder. Paths are relative to it.
export async function grep(p: { root: string; query: string }) {
  const root = clean(fromWire(p.root))
  if (!p.query) return { matches: [], truncated: false }
  const rgBin = rgPath()
  if (rgBin) return rgGrep(rgBin, root, p.query)

  const list = (await files({ root: toWire(root) })).files
  const escaped = p.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(escaped, /\p{Lu}/u.test(p.query) ? 'u' : 'iu')
  const res = { matches: [] as Match[], truncated: false }
  const deadline = Date.now() + 15000
  let next = 0
  const worker = async () => {
    while (next < list.length && !res.truncated && Date.now() < deadline) {
      const rel = list[next++]
      const found = await grepFile(path.join(root, fromWire(rel)), rel, re)
      if (!found.length || res.truncated) continue
      res.matches.push(...found)
      if (res.matches.length >= maxMatches) {
        res.matches = res.matches.slice(0, maxMatches)
        res.truncated = true
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  sortMatches(res.matches)
  return res
}

async function grepFile(abs: string, rel: string, re: RegExp): Promise<Match[]> {
  const info = await fs.stat(abs).catch(() => undefined)
  if (!info?.isFile() || info.size > maxGrepSize) return []
  const data = await fs.readFile(abs).catch(() => undefined)
  if (!data || isBinary(data)) return []
  const out: Match[] = []
  const lines = data.toString('utf8').split('\n')
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].replace(/\r$/, '')
    const m = re.exec(line)
    if (!m) continue
    out.push({ path: rel, line: n + 1, col: chars(line.slice(0, m.index)) + 1, text: clip(line) })
    if (out.length >= 50) break
  }
  return out
}

// ripgrep's output, one "path:line:column:text" per match.
function rgGrep(rgBin: string, root: string, query: string): Promise<{ matches: Match[]; truncated: boolean }> {
  const res = { matches: [] as Match[], truncated: false }
  const args = ['--hidden', '--glob', '!.git', '--smart-case', '--fixed-strings', '--line-number', '--column', '--no-heading',
    '--with-filename', '--color', 'never', '--no-messages', '--max-count', '50', '--max-filesize', '4M', '--', query, '.']
  return new Promise((resolve) => {
    const child = spawn(rgBin, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    const timer = setTimeout(() => child.kill(), 15000)
    const finish = () => {
      clearTimeout(timer)
      sortMatches(res.matches)
      resolve(res)
    }
    child.on('error', finish)
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (l) => {
      if (res.truncated) return
      const m = /^(.*?):(\d+):(\d+):(.*)$/s.exec(l)
      if (!m) return
      const text = m[4]
      let col = Number(m[3]) // a byte offset; converted to characters
      const bytes = Buffer.from(text, 'utf8')
      if (col > 0 && col - 1 <= bytes.length) col = chars(bytes.subarray(0, col - 1).toString('utf8')) + 1
      res.matches.push({ path: toWire(m[1]).replace(/^\.\//, ''), line: Number(m[2]), col, text: clip(text) })
      if (res.matches.length >= maxMatches) {
        res.truncated = true
        child.kill()
      }
    })
    lines.on('close', finish)
  })
}
