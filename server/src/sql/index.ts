// The SQL tabs' connections: each tab has one, by an id it picks, made on this computer (not
// in the project's container). See types.ts for what goes back and forth.
import { type Config, type Db, type Engine, engines, type Info, type Outcome } from './types.ts'

// Each driver is loaded the first time it's used: they're big (SQL Server's most of all), and
// slow to load from a Windows drive under WSL.
const openers: Record<Engine, () => Promise<(c: Config) => Promise<Db>>> = {
  postgres: async () => (await import('./postgres.ts')).openPostgres,
  mysql: async () => (await import('./mysql.ts')).openMysql,
  mssql: async () => (await import('./mssql.ts')).openMssql,
  sqlite: async () => (await import('./sqlite.ts')).openSqlite,
}

export class Sql {
  private dbs = new Map<string, Db>()
  // Connections being made, so a disconnect (or another connect) meanwhile calls them off.
  private starting = new Map<string, symbol>()

  async connect(id: string, config: Config): Promise<Info> {
    if (!config || !engines.includes(config.engine)) throw new Error('pick a database type')
    await this.disconnect(id)
    const token = Symbol(id)
    this.starting.set(id, token)
    let db: Db
    try {
      db = await (await openers[config.engine]())({ ...config, port: Number(config.port) || undefined })
    } catch (e) {
      if (this.starting.get(id) === token) this.starting.delete(id)
      throw e
    }
    if (this.starting.get(id) !== token) {
      await db.close()
      throw new Error('disconnected')
    }
    this.starting.delete(id)
    this.dbs.set(id, db)
    return db.info
  }

  private db(id: string): Db {
    const db = this.dbs.get(id)
    if (!db) throw new Error('not connected')
    return db
  }

  async query(id: string, text: string): Promise<Outcome & { ms: number }> {
    const start = performance.now()
    const out = await this.db(id).query(String(text ?? ''))
    return { ...out, ms: Math.round(performance.now() - start) }
  }

  cancel = (id: string) => this.db(id).cancel()
  tables = (id: string) => this.db(id).tables()
  columns = (id: string, schema: string, table: string) => this.db(id).columns(String(schema ?? ''), String(table ?? ''))

  async disconnect(id: string) {
    this.starting.delete(id)
    const db = this.dbs.get(id)
    this.dbs.delete(id)
    await db?.close()
  }

  async closeAll() {
    await Promise.all([...this.dbs.keys()].map((id) => this.disconnect(id)))
  }
}
