// MySQL and MariaDB, through mysql2 (pure JS).
import mysql from 'mysql2/promise'
import { type Column, type Config, type Db, errText, type ResultSet, rowsOf, type Table } from './types.ts'

type Header = { affectedRows: number; info?: string }
type Fields = { name: string }[] | undefined

const system = "('mysql', 'information_schema', 'performance_schema', 'sys')"

function resultSet(rows: unknown, fields: Fields): ResultSet {
  if (fields && Array.isArray(rows)) return { columns: fields.map((f) => f.name), ...rowsOf(rows as unknown[][]) }
  return { columns: [], rows: [], affected: (rows as Header).affectedRows ?? 0 }
}

export async function openMysql(c: Config): Promise<Db> {
  const options: mysql.ConnectionOptions = {
    host: c.host || 'localhost',
    port: c.port || 3306,
    user: c.user || undefined,
    password: c.password || undefined,
    database: c.database || undefined,
    ssl: c.ssl ? { rejectUnauthorized: false } : undefined,
    connectTimeout: 15000,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  }
  const conn = await mysql.createConnection({ ...options, multipleStatements: true, rowsAsArray: true })
  let lost = ''
  conn.on('error', (e: unknown) => (lost = errText(e)))
  const array = async (sql: string, values?: unknown[]) => (await conn.query({ sql, values, rowsAsArray: true }))[0] as unknown[][]
  const [[version, database, user]] = (await array('select version(), database(), current_user()')) as string[][]

  return {
    info: { engine: 'mysql', version, database: database ?? '', user },
    async query(text) {
      if (lost) throw new Error(`the connection was lost: ${lost}`)
      try {
        const [rows, fields] = (await conn.query(text)) as unknown as [unknown, unknown]
        // Several statements give a list of results with a list of field lists (undefined for
        // statements without rows); one gives its result alone.
        const multi =
          Array.isArray(rows) && Array.isArray(fields) && rows.length === fields.length && fields.every((f) => f === undefined || Array.isArray(f))
        if (multi) return { results: rows.map((r, i) => resultSet(r, (fields as Fields[])[i])) }
        return { results: [resultSet(rows, fields as Fields)] }
      } catch (e) {
        return { results: [], error: errText(e) }
      }
    },
    async cancel() {
      const other = await mysql.createConnection(options)
      other.on('error', () => {})
      try {
        await other.query('KILL QUERY ?', [conn.threadId])
      } finally {
        await other.end().catch(() => {})
      }
    },
    async tables(): Promise<Table[]> {
      const rows = await array(
        `select table_schema, table_name, table_type = 'VIEW' from information_schema.tables
         where table_schema not in ${system} and (database() is null or table_schema = database()) order by 1, 2`,
      )
      return rows.map(([schema, name, view]) => ({ schema: String(schema), name: String(name), view: Number(view) === 1 }))
    },
    async columns(schema, table): Promise<Column[]> {
      const rows = await array(
        `select column_name, column_type, is_nullable = 'YES', column_key = 'PRI' from information_schema.columns
         where table_schema = ? and table_name = ? order by ordinal_position`,
        [schema, table],
      )
      return rows.map(([name, type, nullable, key]) => ({ name: String(name), type: String(type), nullable: Number(nullable) === 1, key: Number(key) === 1 }))
    },
    async close() {
      await conn.end().catch(() => {})
    },
  }
}
