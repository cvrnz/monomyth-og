// SQLite through node:sqlite, in a child Node process: its calls block, so a long query would
// otherwise hold up the server (terminals included), and only killing the process can stop
// one. Cancelling kills it and opens the file again.
import { type ChildProcess, fork } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expandHome, fromWindowsPath } from '../wire.ts'
import type { Column, Config, Db, Info, Outcome, Table } from './types.ts'

export function sqlitePath(file: string): string {
  const f = file.trim()
  if (f === ':memory:') return f
  return path.resolve(os.homedir(), expandHome(fromWindowsPath(f)))
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void }

export async function openSqlite(c: Config): Promise<Db> {
  if (!c.file?.trim()) throw new Error('choose the database file')
  const file = sqlitePath(c.file)
  if (file !== ':memory:' && !existsSync(file)) throw new Error(`there's no file at ${file}`)

  let child: ChildProcess
  let next = 0
  const pending = new Map<number, Pending>()
  let closing = false
  const start = () => {
    const w = fork(new URL('./sqliteChild.ts', import.meta.url), [file], { serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
    let stderr = ''
    w.stderr?.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)))
    w.on('message', ({ id, result, error }: { id: number; result?: unknown; error?: string }) => {
      const p = pending.get(id)
      pending.delete(id)
      if (error !== undefined) p?.reject(new Error(error))
      else p?.resolve(result)
    })
    const fail = (why: string) => {
      if (child !== w) return
      for (const p of pending.values()) p.reject(new Error(why))
      pending.clear()
      if (!closing) start()
    }
    w.on('error', (e) => fail(e.message))
    w.on('exit', (code, signal) => fail(signal === 'SIGKILL' ? 'cancelled' : stderr.trim().split('\n').pop() || `sqlite stopped (${code ?? signal})`))
    child = w
  }
  const call = <T>(op: string, args: unknown = {}) =>
    new Promise<T>((resolve, reject) => {
      const id = ++next
      pending.set(id, { resolve, reject })
      child.send({ id, op, args })
    })

  start()
  const info = await call<Info>('info').catch(async (e) => {
    closing = true
    child.kill('SIGKILL')
    throw e
  })

  return {
    info,
    async query(text) {
      try {
        return await call<Outcome>('query', { text })
      } catch (e) {
        return { results: [], error: (e as Error).message }
      }
    },
    async cancel() {
      if (pending.size) child.kill('SIGKILL')
    },
    tables: () => call<Table[]>('tables'),
    columns: (schema, table) => call<Column[]>('columns', { schema, table }),
    async close() {
      closing = true
      child.kill('SIGKILL')
    },
  }
}
