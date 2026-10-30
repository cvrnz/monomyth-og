// Source control on this computer: the scm.* methods (see internal/agent/git.go).
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { clean, fromWire, isBinary, run, toWire } from '../wire.ts'

type GitResult = { ok: boolean; stdout: string; raw: Buffer; stderr: string }

// Runs git in a repo. With quiet set, talking to remotes never prompts: a remote that needs a
// password or an unknown host key just fails, rather than waiting on input nobody can type.
export async function git(repo: string, quiet: boolean, ...args: string[]): Promise<GitResult> {
  const env = { ...process.env }
  if (quiet) {
    env.GIT_TERMINAL_PROMPT = '0'
    if (!process.env.GIT_SSH_COMMAND) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes'
  }
  const r = await run('git', ['-C', repo, ...args], { env })
  return { ok: r.ok, stdout: r.stdout.toString('utf8'), raw: r.stdout, stderr: r.stderr }
}

export async function rootOf(dir: string): Promise<string> {
  const r = await git(dir, false, 'rev-parse', '--show-toplevel')
  return r.ok ? clean(r.stdout.trim()) : ''
}

// Repos at or above a folder, plus any below it (a few levels deep, skipping node_modules).
async function findRepos(folder: string): Promise<string[]> {
  const above = await rootOf(folder)
  const repos = above ? [above] : []
  const walk = async (dir: string, depth: number) => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (e.name === '.git') {
        if (clean(dir) !== above) repos.push(clean(dir))
      } else if (e.isDirectory() && e.name !== 'node_modules' && depth < 3) {
        await walk(path.join(dir, e.name), depth + 1)
      }
    }
  }
  await walk(folder, 0)
  return repos
}

type Change = { status: string; path: string; old?: string }

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

// Changed files from `git status`, sorted by path. Untracked files are "U".
async function changes(repo: string): Promise<Change[]> {
  const r = await git(repo, false, 'status', '--porcelain=v1', '-z', '--untracked-files=all')
  const fields = r.stdout.split('\0')
  const list: Change[] = []
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]
    if (f.length < 4) continue
    const xy = f.slice(0, 2)
    const c: Change = { status: xy === '??' ? 'U' : xy.trim().slice(0, 1), path: f.slice(3) }
    if (/[RC]/.test(xy) && i + 1 < fields.length) c.old = fields[++i]
    list.push(c)
  }
  return list.sort((a, b) => byPath(a.path, b.path))
}

async function branch(repo: string): Promise<string> {
  const name = (await git(repo, false, 'branch', '--show-current')).stdout.trim()
  if (name) return name
  const sha = (await git(repo, false, 'rev-parse', '--short', 'HEAD')).stdout.trim()
  return sha ? 'detached at ' + sha : 'no commits yet'
}

type SyncCounts = { ahead: number; behind: number }

// Commits to push and to pull, as of the last fetch; null for a branch with no upstream.
async function syncOf(repo: string): Promise<SyncCounts | null> {
  const r = await git(repo, false, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}')
  const m = /(\d+)\s+(\d+)/.exec(r.stdout)
  if (!r.ok || !m) return null
  return { ahead: Number(m[1]), behind: Number(m[2]) }
}

// The first remote, which a branch with no upstream is published to.
async function remoteOf(repo: string): Promise<string> {
  return (await git(repo, false, 'remote')).stdout.trim().split('\n')[0].trim()
}

function arrows(s: SyncCounts | null): string {
  if (!s) return ''
  const parts: string[] = []
  if (s.behind > 0) parts.push('↓' + s.behind)
  if (s.ahead > 0) parts.push('↑' + s.ahead)
  return parts.join(' ')
}

const plural = (n: number, word: string) => (n === 1 ? '1 ' + word : `${n} ${word}s`)

// What the sync button does, like VS Code's: pull, push, both, publish a branch with no
// upstream, or (with nothing to do) check the remote for new commits. "pull" in steps stands
// for the pull command the repo is configured for.
type Action = { label: string; verb: string; done: string; dim?: boolean; steps: string[][]; fetch?: boolean }

function actionFor(s: SyncCounts | null, remote: string): Action | null {
  if (!s && !remote) return null
  if (!s) return { label: '↑ Publish branch', verb: 'Publishing', done: 'Published', steps: [['push', '--set-upstream', remote, 'HEAD']] }
  if (s.behind > 0 && s.ahead > 0) return { label: '⇅ Sync changes  ' + arrows(s), verb: 'Syncing', done: 'Synced', steps: [['pull'], ['push']] }
  if (s.behind > 0) return { label: '↓ Pull ' + plural(s.behind, 'commit'), verb: 'Pulling', done: 'Pulled', steps: [['pull']] }
  if (s.ahead > 0) return { label: '↑ Push ' + plural(s.ahead, 'commit'), verb: 'Pushing', done: 'Pushed', steps: [['push']] }
  return { label: '✓ Up to date', verb: 'Checking', done: 'Up to date', dim: true, steps: [], fetch: true }
}

// Only what the window shows goes over the wire.
const wireAction = (a: Action | null) => a && { label: a.label, verb: a.verb, done: a.done, ...(a.dim ? { dim: true } : {}) }

// Pull as the repo is configured to; with nothing configured, git refuses to pull diverged
// branches, so merge then (VS Code's default too).
async function pullArgs(repo: string): Promise<string[]> {
  const [rebase, ff] = await Promise.all([git(repo, false, 'config', 'pull.rebase'), git(repo, false, 'config', 'pull.ff')])
  return rebase.ok || ff.ok ? ['pull', '--no-edit'] : ['pull', '--no-edit', '--no-rebase']
}

async function infoOf(repo: string, name: string) {
  const [br, sync, remote, list] = await Promise.all([branch(repo), syncOf(repo), remoteOf(repo), changes(repo)])
  return {
    path: toWire(repo),
    name: toWire(name),
    branch: br,
    sync,
    arrows: arrows(sync),
    remote,
    count: list.length,
    action: wireAction(actionFor(sync, remote)),
  }
}

// Every repo in the given folders, named by their path relative to the folder.
export async function repos(p: { roots?: string[] }) {
  const all: { repo: string; name: string }[] = []
  const seen = new Set<string>()
  for (const r of p.roots ?? []) {
    const root = fromWire(r)
    for (const repo of await findRepos(root)) {
      if (seen.has(repo)) continue
      seen.add(repo)
      let name = path.relative(root, repo)
      if (name === '' || name.startsWith('..') || path.isAbsolute(name)) name = path.basename(repo)
      all.push({ repo, name })
    }
  }
  const out = await Promise.all(all.map((f) => infoOf(f.repo, f.name)))
  return out.sort((a, b) => byPath(a.name, b.name))
}

export async function scmChanges(p: { repo: string }) {
  return changes(fromWire(p.repo))
}

// The file at the last commit and in the working tree, for a side-by-side diff.
export async function versions(p: { repo: string; change: Change }) {
  const repo = fromWire(p.repo)
  const toVersion = (data: Buffer) => (isBinary(data) ? { content: '(binary file)', binary: true } : { content: data.toString('utf8'), binary: false })
  let old = { content: '', binary: false }
  let now = { content: '', binary: false }
  const c = p.change
  if (c.status !== 'U' && c.status !== 'A' && (await git(repo, false, 'rev-parse', '--verify', '--quiet', 'HEAD')).ok) {
    const r = await git(repo, false, 'show', 'HEAD:' + (c.old || c.path))
    if (r.ok) old = toVersion(r.raw)
  }
  if (c.status !== 'D') {
    const data = await fs.readFile(path.join(repo, fromWire(c.path))).catch(() => undefined)
    if (data) now = toVersion(data)
  }
  return { old, new: now }
}

// Fetch so the pull count is current. Returns the repo's fresh info.
export async function fetch(p: { repo: string; name: string }) {
  const repo = fromWire(p.repo)
  const r = await git(repo, true, 'fetch', '--quiet', '--no-tags')
  if (!r.ok) throw new Error(r.stderr.trim())
  return infoOf(repo, p.name)
}

// Run the sync button's action: its git commands in turn.
export async function sync(p: { repo: string }) {
  const repo = fromWire(p.repo)
  const [counts, remote] = await Promise.all([syncOf(repo), remoteOf(repo)])
  const a = actionFor(counts, remote)
  if (!a) throw new Error('this branch has no remote to sync with')
  if (a.fetch) {
    const r = await git(repo, true, 'fetch', '--quiet', '--no-tags')
    if (!r.ok) throw new Error(r.stderr.trim())
    return {}
  }
  for (let args of a.steps) {
    if (args[0] === 'pull') args = await pullArgs(repo)
    const r = await git(repo, true, ...args)
    if (!r.ok) throw new Error(`git ${args.join(' ')}: ${(r.stderr + r.stdout).trim()}`)
  }
  return {}
}
