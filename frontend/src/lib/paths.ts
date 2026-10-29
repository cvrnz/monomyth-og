// Paths in the container are always POSIX, whatever the laptop runs.

export function basename(p: string): string {
  const parts = p.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || '/'
}

export function dirname(p: string): string {
  const trimmed = p.replace(/\/+$/, '')
  const i = trimmed.lastIndexOf('/')
  if (i <= 0) return '/'
  return trimmed.slice(0, i)
}

export function join(...parts: string[]): string {
  let out = ''
  for (const part of parts) {
    if (!part) continue
    if (part.startsWith('/')) out = part
    else out = out.endsWith('/') ? out + part : `${out}/${part}`
  }
  return normalize(out)
}

export function normalize(p: string): string {
  const abs = p.startsWith('/')
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return (abs ? '/' : '') + out.join('/')
}

// A path for showing: relative to the folder when inside it, with ~ for home.
export function pretty(p: string, root: string, home: string): string {
  if (root && (p === root || p.startsWith(root + '/'))) return p.slice(root.length + 1) || basename(p)
  if (home && (p === home || p.startsWith(home + '/'))) return '~' + p.slice(home.length)
  return p
}

export function isInside(p: string, dir: string): boolean {
  return p === dir || p.startsWith(dir.endsWith('/') ? dir : dir + '/')
}
