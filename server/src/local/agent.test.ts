import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { toWire } from '../wire.ts'
import { LocalAgent } from './agent.ts'

const dir = mkdtempSync(path.join(os.tmpdir(), 'monomyth-test-'))
const wire = toWire(dir)
const events: { event: string; params: any }[] = []
const agent = new LocalAgent((event, params) => events.push({ event, params }))
const call = async (method: string, params: unknown) => JSON.parse(await agent.call(method, JSON.stringify(params)))

after(async () => {
  await agent.close()
  rmSync(dir, { recursive: true, force: true })
})

test('files: create, write, read, list, rename, stat', async () => {
  await call('fs.create', { path: `${wire}/sub`, dir: true })
  await call('fs.write', { path: `${wire}/sub/a.txt`, content: 'héllo\n' })
  assert.deepEqual(await call('fs.read', { path: `${wire}/sub/a.txt` }), { content: 'héllo\n', binary: false, tooLarge: false, size: 7 })
  await assert.rejects(call('fs.create', { path: `${wire}/sub/a.txt` }), /a\.txt already exists/)
  writeFileSync(path.join(dir, 'Z.bin'), Buffer.from([1, 0, 2]))
  assert.deepEqual((await call('fs.read', { path: `${wire}/Z.bin` })).binary, true)
  const list = await call('fs.list', { path: wire })
  assert.deepEqual(list.map((e: { name: string }) => e.name), ['sub', 'Z.bin'])
  await call('fs.rename', { from: `${wire}/sub/a.txt`, to: `${wire}/new/b.txt` })
  assert.deepEqual(await call('fs.stat', { path: `${wire}/new/b.txt` }), { exists: true, dir: false })
  assert.deepEqual(await call('fs.stat', { path: `${wire}/sub/a.txt` }), { exists: false, dir: false })
})

test('delete refuses roots and relative paths', async () => {
  await assert.rejects(call('fs.delete', { path: 'relative' }), /refusing/)
  await assert.rejects(call('fs.delete', { path: path.parse(dir).root }), /refusing/)
  if (process.platform === 'win32') await assert.rejects(call('fs.delete', { path: '/Windows' }), /refusing/)
  await call('fs.delete', { path: `${wire}/new` })
  assert.equal((await call('fs.stat', { path: `${wire}/new` })).exists, false)
})

test('search and source control in a repo', async () => {
  const repo = path.join(dir, 'repo')
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' })
  execFileSync('git', ['init', '-q', repo])
  git('config', 'user.email', 't@example.com')
  git('config', 'user.name', 't')
  writeFileSync(path.join(repo, '.gitignore'), 'ignored.txt\n')
  writeFileSync(path.join(repo, 'one.txt'), 'alpha\nNeedle here\n')
  git('add', '.')
  git('commit', '-qm', 'first')
  writeFileSync(path.join(repo, 'one.txt'), 'alpha\nneedle changed\n')
  writeFileSync(path.join(repo, 'two.txt'), 'xx needle\n')
  writeFileSync(path.join(repo, 'ignored.txt'), 'needle\n')

  const files = (await call('fs.files', { root: toWire(repo) })).files.sort()
  assert.deepEqual(files, ['.gitignore', 'one.txt', 'two.txt'])
  const grep = await call('fs.grep', { root: toWire(repo), query: 'needle' })
  assert.deepEqual(grep.matches.map((m: any) => [m.path, m.line, m.col]), [['one.txt', 2, 1], ['two.txt', 1, 4]])
  assert.equal((await call('fs.grep', { root: toWire(repo), query: 'Needle' })).matches.length, 0)

  const [info] = await call('scm.repos', { roots: [wire] })
  assert.equal(info.name, 'repo')
  assert.equal(info.count, 2)
  assert.equal(info.action, null)
  const changes = await call('scm.changes', { repo: info.path })
  assert.deepEqual(changes, [{ status: 'M', path: 'one.txt' }, { status: 'U', path: 'two.txt' }])
  const v = await call('scm.versions', { repo: info.path, change: changes[0] })
  assert.equal(v.old.content.replace(/\r/g, ''), 'alpha\nNeedle here\n')
  assert.equal(v.new.content, readFileSync(path.join(repo, 'one.txt'), 'utf8'))
})

test('a terminal runs a command and reports its exit', async () => {
  const { id } = await call('term.open', { cols: 80, rows: 24, cwd: wire })
  const exited = new Promise<number>((resolve) => {
    const timer = setInterval(() => {
      const e = events.find((e) => e.event === 'term.exit' && e.params.id === id)
      if (e) {
        clearInterval(timer)
        resolve(e.params.code)
      }
    }, 50)
  })
  await call('term.resize', { id, cols: 100, rows: 30 })
  await call('term.input', { id, data: Buffer.from('echo mono$("myth")\rexit\r').toString('base64') })
  await exited
  const output = events
    .filter((e) => e.event === 'term.data' && e.params.id === id)
    .map((e) => Buffer.from(e.params.data, 'base64').toString('utf8'))
    .join('')
  assert.match(output, /monomyth/)
  await assert.rejects(call('term.input', { id, data: '' }), /no terminal/)
})
