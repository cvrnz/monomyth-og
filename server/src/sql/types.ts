// What the SQL tab sends and gets back, the same for every database.

export type Engine = 'postgres' | 'mysql' | 'mssql' | 'sqlite'
export const engines: Engine[] = ['postgres', 'mysql', 'mssql', 'sqlite']

// Where to connect. SQLite only uses file; the others the rest.
export type Config = {
  engine: Engine
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  file?: string
  ssl?: boolean
  // SQL Server: accept a self-signed certificate.
  trustCert?: boolean
}

export type Cell = string | number | boolean | null

// One statement's result: rows (columns non-empty), or what it did (command, affected).
export type ResultSet = { columns: string[]; rows: Cell[][]; truncated?: boolean; affected?: number; command?: string }

// What a run did: the results of the statements that ran, the error that stopped it (with its
// character offset in the text, 1-based, when the database says where), and messages the
// database printed (notices, PRINT).
export type Outcome = { results: ResultSet[]; error?: string; position?: number; notices?: string[] }

export type Table = { schema: string; name: string; view: boolean }
export type Column = { name: string; type: string; nullable: boolean; key: boolean }
export type Info = { engine: Engine; version: string; database: string; user: string }

export interface Db {
  info: Info
  query(text: string): Promise<Outcome>
  // Stops the running query; it then ends with an error.
  cancel(): Promise<void>
  tables(): Promise<Table[]>
  columns(schema: string, table: string): Promise<Column[]>
  close(): Promise<void>
}

// The most rows kept from one result, so a big table doesn't flood the window.
export const MAX_ROWS = 10000

const MAX_CELL = 10000

// A value as the window shows it: dates as ISO text, bytes as hex, big numbers as text,
// anything else structured (JSON, arrays) as JSON.
export function cell(v: unknown): Cell {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v.length > MAX_CELL ? v.slice(0, MAX_CELL) + '…' : v
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v)
  if (typeof v === 'bigint') return v.toString()
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? String(v) : v.toISOString()
  if (v instanceof Uint8Array) {
    const hex = Buffer.from(v.buffer, v.byteOffset, Math.min(v.byteLength, MAX_CELL / 2)).toString('hex')
    return '0x' + hex + (v.byteLength > MAX_CELL / 2 ? '…' : '')
  }
  return cell(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)))
}

export function rowsOf(rows: unknown[][]): { rows: Cell[][]; truncated?: boolean } {
  const kept = rows.length > MAX_ROWS ? rows.slice(0, MAX_ROWS) : rows
  return { rows: kept.map((r) => r.map(cell)), ...(rows.length > MAX_ROWS ? { truncated: true } : {}) }
}

export function errText(e: unknown): string {
  if (e instanceof AggregateError && e.errors.length) return errText(e.errors[0])
  if (e instanceof Error) return e.message || e.name
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}
