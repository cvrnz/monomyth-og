// Files on this computer: the fs.* methods and hello (see internal/agent/files.go, which the
// container agent runs; the two answer alike).
import { randomInt } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { clean, expandHome, fromWire, isBinary, isWindows, toWire } from '../wire.ts'
import { loginShell } from './term.ts'

const maxReadBytes = 20 * 1024 * 1024

const exists = (p: string) => fs.lstat(p).then(() => true, () => false)

// The folder to open: the one asked for, else Dev Spaces' projects folder, else where the
// server started, else home.
export async function hello(p: { root?: string }) {
  const home = os.homedir()
  let root = fromWire(p.root || '') || process.env.PROJECTS_ROOT || ''
  if (!root && process.cwd() !== '/') root = process.cwd()
  root = expandHome(root || home)
  const info = await fs.stat(root).catch(() => undefined)
  if (!info?.isDirectory()) throw new Error(`${root} isn't a folder`)
  let user = ''
  try {
    user = os.userInfo().username
  } catch {
    // No user name (an unnamed uid): leave it empty.
  }
  return { hostname: os.hostname(), user, home: toWire(home), root: toWire(clean(path.resolve(root))), shell: toWire(loginShell()) }
}

// Folders first, then files, each sorted case-insensitively.
export async function list(p: { path: string }) {
  const dir = fromWire(p.path)
  const items = await fs.readdir(dir, { withFileTypes: true })
  const out = await Promise.all(
    items.map(async (item) => {
      const e = { name: item.name, dir: item.isDirectory(), link: item.isSymbolicLink(), size: 0 }
      const full = path.join(dir, item.name)
      const info = await fs.lstat(full).catch(() => undefined)
      if (info) e.size = info.size
      if (e.link) {
        const target = await fs.stat(full).catch(() => undefined)
        if (target) e.dir = target.isDirectory()
      }
      return e
    }),
  )
  const key = (s: string) => s.toLowerCase()
  return out.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : key(a.name) < key(b.name) ? -1 : key(a.name) > key(b.name) ? 1 : 0))
}

export async function read(p: { path: string; limit?: number }) {
  const file = fromWire(p.path)
  const info = await fs.stat(file)
  if (info.isDirectory()) throw new Error(`${file} is a folder`)
  const limit = p.limit && p.limit > 0 && p.limit < maxReadBytes ? p.limit : maxReadBytes
  if (info.size > limit) return { content: '', binary: false, tooLarge: true, size: info.size }
  const data = await fs.readFile(file)
  if (isBinary(data)) return { content: '', binary: true, tooLarge: false, size: info.size }
  return { content: data.toString('utf8'), binary: false, tooLarge: false, size: info.size }
}

// Writes go to a temporary file beside the target, renamed over it, so a failed write never
// leaves a half-written file. The file keeps its permissions, and a symlink keeps pointing
// where it did (the file it points to is the one replaced).
export async function write(p: { path: string; content: string }) {
  let target = fromWire(p.path)
  target = await fs.realpath(target).catch(() => target)
  let mode = 0o644
  const info = await fs.stat(target).catch(() => undefined)
  if (info) {
    if (info.isDirectory()) throw new Error(`${target} is a folder`)
    mode = info.mode & 0o777
  } else {
    await fs.mkdir(path.dirname(target), { recursive: true })
  }
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${randomInt(1e9)}.tmp`)
  let handle: fs.FileHandle
  try {
    handle = await fs.open(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
  } catch {
    // A folder we can't create files in may still have a writable file: write in place.
    await fs.writeFile(target, p.content, { mode })
    return {}
  }
  try {
    await handle.writeFile(p.content)
    await handle.close()
    await fs.chmod(tmp, mode)
    await fs.rename(tmp, target)
  } catch (e) {
    await handle.close().catch(() => {})
    await fs.rm(tmp, { force: true })
    throw e
  }
  return {}
}

export async function create(p: { path: string; dir?: boolean }) {
  const file = fromWire(p.path)
  if (await exists(file)) throw new Error(`${path.basename(file)} already exists`)
  if (p.dir) {
    await fs.mkdir(file, { recursive: true })
    return {}
  }
  await fs.mkdir(path.dirname(file), { recursive: true })
  await (await fs.open(file, 'wx', 0o644)).close()
  return {}
}

export async function rename(p: { from: string; to: string }) {
  const from = fromWire(p.from)
  const to = fromWire(p.to)
  if (await exists(to)) throw new Error(`${path.basename(to)} already exists`)
  await fs.mkdir(path.dirname(to), { recursive: true })
  await fs.rename(from, to)
  return {}
}

export async function remove(p: { path: string }) {
  const target = clean(fromWire(p.path))
  // Never a whole drive or the root (or a relative path, which means nothing here). On Windows
  // a path needs its drive (or a UNC share): \foo depends on the current drive.
  const absolute = isWindows ? /^([a-zA-Z]:\\|\\\\)/.test(target) : path.isAbsolute(target)
  if (target === '.' || path.dirname(target) === target || !absolute) {
    throw new Error('refusing to delete ' + target)
  }
  await fs.rm(target, { recursive: true, force: true })
  return {}
}

export async function stat(p: { path: string }) {
  try {
    const info = await fs.stat(fromWire(p.path))
    return { exists: true, dir: info.isDirectory() }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false, dir: false }
    throw e
  }
}
