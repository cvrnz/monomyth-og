// The process behind sqlite.ts: opens the file (its first argument) and answers its calls one
// at a time.
import { DatabaseSync } from 'node:sqlite'
import { splitSqlite } from './split.ts'
import { type Cell, cell, errText, MAX_ROWS, type Outcome, type ResultSet } from './types.ts'

const file = process.argv[2]
let db: DatabaseSync | undefined
const open = () => (db ??= new DatabaseSync(file))

const ops: Record<string, (args: any) => unknown> = {
  info: () => {
    const d = open()
    // Reading the schema checks that the file is a database.
    const row = d.prepare('select sqlite_version() as v, (select count(*) from sqlite_schema) as n').get() as { v: string }
    return { engine: 'sqlite', version: row.v, database: file, user: '' }
  },
  query: ({ text }: { text: string }): Outcome => {
    const d = open()
    const results: ResultSet[] = []
    for (const sql of splitSqlite(text)) {
      try {
        const st = d.prepare(sql)
        const columns = st.columns()
        if (columns.length) {
          st.setReturnArrays(true)
          const rows: Cell[][] = []
          let truncated = false
          for (const r of st.iterate() as Iterable<unknown[]>) {
            if (rows.length >= MAX_ROWS) {
              truncated = true
              break
            }
            rows.push(r.map(cell))
          }
          results.push({ columns: columns.map((c) => c.name), rows, ...(truncated ? { truncated } : {}) })
        } else {
          const r = st.run()
          const command = sql.match(/^\s*(\w+)/)?.[1]?.toUpperCase() ?? ''
          const dml = /^(INSERT|UPDATE|DELETE|REPLACE)$/.test(command)
          results.push({ columns: [], rows: [], command, ...(dml ? { affected: Number(r.changes) } : {}) })
        }
      } catch (e) {
        return { results, error: errText(e) }
      }
    }
    return { results }
  },
  tables: () =>
    (open().prepare("select name, type = 'view' as view from sqlite_schema where type in ('table', 'view') and name not like 'sqlite_%' order by name").all() as { name: string; view: number }[]).map(
      (r) => ({ schema: 'main', name: r.name, view: r.view === 1 }),
    ),
  columns: ({ table }: { table: string }) =>
    (open().prepare('select name, type, "notnull" as nn, pk from pragma_table_info(?)').all(table) as { name: string; type: string; nn: number; pk: number }[]).map((r) => ({
      name: r.name,
      type: r.type,
      nullable: r.nn === 0,
      key: r.pk > 0,
    })),
}

process.on('message', ({ id, op, args }: { id: number; op: string; args: unknown }) => {
  try {
    process.send!({ id, result: ops[op](args) })
  } catch (e) {
    process.send!({ id, error: errText(e) })
  }
})
// The server went away.
process.on('disconnect', () => process.exit(0))
