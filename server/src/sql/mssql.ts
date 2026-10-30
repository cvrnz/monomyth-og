// SQL Server, through mssql/tedious (pure JS). A script is run a batch at a time, split on GO.
import mssql from 'mssql'
import { splitBatches } from './split.ts'
import { type Column, type Config, type Db, errText, type ResultSet, rowsOf, type Table } from './types.ts'

const columnsSql = `
select c.COLUMN_NAME, c.DATA_TYPE,
  case when c.IS_NULLABLE = 'YES' then 1 else 0 end,
  case when exists (
    select 1 from INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
    join INFORMATION_SCHEMA.KEY_COLUMN_USAGE k on k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME and k.TABLE_SCHEMA = tc.TABLE_SCHEMA
    where tc.CONSTRAINT_TYPE = 'PRIMARY KEY' and tc.TABLE_SCHEMA = c.TABLE_SCHEMA and tc.TABLE_NAME = c.TABLE_NAME
      and k.COLUMN_NAME = c.COLUMN_NAME) then 1 else 0 end
from INFORMATION_SCHEMA.COLUMNS c
where c.TABLE_SCHEMA = @schema and c.TABLE_NAME = @table
order by c.ORDINAL_POSITION`

type Result = { recordsets: unknown[][][]; rowsAffected: number[]; columns?: { name: string }[][] }

export async function openMssql(c: Config): Promise<Db> {
  // DOMAIN\user signs in with NTLM.
  const [domain, user] = c.user?.includes('\\') ? c.user.split('\\', 2) : [undefined, c.user]
  const pool = new mssql.ConnectionPool({
    server: c.host || 'localhost',
    port: c.port || 1433,
    user: user || undefined,
    domain,
    password: c.password || undefined,
    database: c.database || undefined,
    connectionTimeout: 15000,
    requestTimeout: 0,
    // One connection, kept, so SET, USE and temp tables last between runs.
    pool: { min: 1, max: 1, idleTimeoutMillis: 2 ** 31 - 1 },
    options: { encrypt: Boolean(c.ssl), trustServerCertificate: c.trustCert ?? true, appName: 'monomyth' },
  })
  let lost = ''
  pool.on('error', (e) => (lost = errText(e)))
  await pool.connect()
  let current: mssql.Request | null = null
  let notices: string[] = []

  const run = async (text: string, params: Record<string, string> = {}): Promise<Result> => {
    const req = pool.request()
    req.arrayRowMode = true
    for (const [k, v] of Object.entries(params)) req.input(k, v)
    req.on('info', (m: { message: string }) => notices.push(m.message))
    current = req
    try {
      return (await req.query(text)) as unknown as Result
    } finally {
      if (current === req) current = null
    }
  }
  const array = async (text: string, params?: Record<string, string>) => (await run(text, params)).recordsets[0] ?? []
  const [[version, database, who]] = (await array("select cast(SERVERPROPERTY('ProductVersion') as nvarchar(128)), DB_NAME(), SUSER_SNAME()")) as string[][]

  return {
    info: { engine: 'mssql', version, database, user: who },
    async query(text) {
      if (lost) throw new Error(`the connection was lost: ${lost}`)
      notices = []
      const results: ResultSet[] = []
      for (const batch of splitBatches(text)) {
        try {
          const r = await run(batch)
          r.recordsets.forEach((rows, i) => results.push({ columns: (r.columns?.[i] ?? []).map((col) => col.name), ...rowsOf(rows) }))
          if (r.recordsets.length === 0) results.push({ columns: [], rows: [], affected: r.rowsAffected.reduce((a, b) => a + b, 0) })
        } catch (e) {
          return { results, error: errText(e), notices }
        }
      }
      return { results, notices }
    },
    async cancel() {
      current?.cancel()
    },
    async tables(): Promise<Table[]> {
      const rows = await array("select TABLE_SCHEMA, TABLE_NAME, case when TABLE_TYPE = 'VIEW' then 1 else 0 end from INFORMATION_SCHEMA.TABLES order by 1, 2")
      return rows.map(([schema, name, view]) => ({ schema: String(schema), name: String(name), view: Number(view) === 1 }))
    },
    async columns(schema, table): Promise<Column[]> {
      const rows = await array(columnsSql, { schema, table })
      return rows.map(([name, type, nullable, key]) => ({ name: String(name), type: String(type), nullable: Number(nullable) === 1, key: Number(key) === 1 }))
    },
    async close() {
      await pool.close().catch(() => {})
    },
  }
}
