// PostgreSQL, through node-postgres (pure JS).
import pg from 'pg'
import { type Column, type Config, type Db, errText, type ResultSet, rowsOf, type Table } from './types.ts'

// Dates, times and intervals as Postgres writes them, not as JS Dates in the local zone.
const asText = new Set([1082, 1083, 1114, 1184, 1186, 1266])
const types = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
    asText.has(oid) ? (v: string) => v : pg.types.getTypeParser(oid, format as 'text')) as typeof pg.types.getTypeParser,
}

const tablesSql = `
select table_schema, table_name, table_type = 'VIEW'
from information_schema.tables
where table_schema not in ('pg_catalog', 'information_schema') and table_schema not like 'pg_toast%' and table_schema not like 'pg_temp%'
order by 1, 2`

const columnsSql = `
select c.column_name,
  case when c.data_type = 'USER-DEFINED' then c.udt_name when c.data_type = 'ARRAY' then substr(c.udt_name, 2) || '[]' else c.data_type end,
  c.is_nullable = 'YES',
  exists (
    select 1 from information_schema.table_constraints tc
    join information_schema.key_column_usage k
      on k.constraint_name = tc.constraint_name and k.table_schema = tc.table_schema and k.table_name = tc.table_name
    where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = c.table_schema and tc.table_name = c.table_name
      and k.column_name = c.column_name)
from information_schema.columns c
where c.table_schema = $1 and c.table_name = $2
order by c.ordinal_position`

function resultSet(r: pg.QueryResult<unknown[]>): ResultSet {
  if (r.fields.length) return { columns: r.fields.map((f) => f.name), ...rowsOf(r.rows), command: r.command }
  return { columns: [], rows: [], command: r.command, ...(r.rowCount !== null && /^(INSERT|UPDATE|DELETE|MERGE|COPY)$/.test(r.command) ? { affected: r.rowCount } : {}) }
}

export async function openPostgres(c: Config): Promise<Db> {
  const config: pg.ClientConfig = {
    host: c.host || 'localhost',
    port: c.port || 5432,
    user: c.user || undefined,
    password: c.password || undefined,
    database: c.database || undefined,
    ssl: c.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 15000,
    application_name: 'monomyth',
    types,
  }
  const client = new pg.Client(config)
  let lost = ''
  client.on('error', (e) => (lost = errText(e)))
  let notices: string[] = []
  client.on('notice', (n) => notices.push(n.message ?? String(n)))
  await client.connect()
  const array = async (text: string, values?: unknown[]) => (await client.query<unknown[]>({ text, values, rowMode: 'array' })).rows
  const [[version, database, user]] = (await array("select current_setting('server_version'), current_database(), current_user")) as string[][]

  return {
    info: { engine: 'postgres', version, database, user },
    async query(text) {
      if (lost) throw new Error(`the connection was lost: ${lost}`)
      notices = []
      try {
        // With no parameters the whole text goes as one simple query, which may hold many
        // statements, each with its own result.
        const r = (await client.query({ text, rowMode: 'array' })) as unknown as pg.QueryResult<unknown[]> | pg.QueryResult<unknown[]>[]
        return { results: (Array.isArray(r) ? r : [r]).map(resultSet), notices }
      } catch (e) {
        const pos = Number((e as { position?: string }).position)
        return { results: [], error: errText(e), ...(pos > 0 ? { position: pos } : {}), notices }
      }
    },
    async cancel() {
      const pid = (client as unknown as { processID: number | null }).processID
      if (!pid) return
      const other = new pg.Client(config)
      other.on('error', () => {})
      await other.connect()
      try {
        await other.query('select pg_cancel_backend($1)', [pid])
      } finally {
        await other.end().catch(() => {})
      }
    },
    async tables(): Promise<Table[]> {
      return (await array(tablesSql)).map(([schema, name, view]) => ({ schema: String(schema), name: String(name), view: Boolean(view) }))
    },
    async columns(schema, table): Promise<Column[]> {
      return (await array(columnsSql, [schema, table])).map(([name, type, nullable, key]) => ({
        name: String(name),
        type: String(type),
        nullable: Boolean(nullable),
        key: Boolean(key),
      }))
    },
    async close() {
      await client.end().catch(() => {})
    },
  }
}
