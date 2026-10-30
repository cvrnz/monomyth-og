import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { Sql } from './index.ts'
import { splitBatches, splitSqlite } from './split.ts'

test('splitSqlite splits on ; outside strings, comments and trigger bodies', () => {
  const text = `
    -- a comment; not a statement
    select 'a;b', "c;d", [e;f];
    /* block; comment */ insert into t values (1);;
    create trigger tr after insert on t begin
      update t set x = case when x > 1 then 1 else 2 end;
      delete from u;
    end;
    -- trailing comment only`
  const parts = splitSqlite(text)
  assert.equal(parts.length, 3)
  assert.match(parts[0], /^-- a comment; not a statement\s+select 'a;b', "c;d", \[e;f\]$/)
  assert.match(parts[1], /insert into t values \(1\)$/)
  assert.match(parts[2], /^create trigger[\s\S]*delete from u;\s+end$/)
})

test('splitBatches splits SQL Server scripts on GO lines', () => {
  assert.deepEqual(splitBatches('select 1\nGO\n  go  \nselect 2\ngo -- done\n'), ['select 1', 'select 2'])
})

const dir = mkdtempSync(path.join(os.tmpdir(), 'monomyth-sql-'))
const sql = new Sql()
after(async () => {
  await sql.closeAll()
  rmSync(dir, { recursive: true, force: true })
})

test('SQLite: connect, run a script, list tables and columns', async () => {
  const file = path.join(dir, 'a.db')
  writeFileSync(file, '')
  const info = await sql.connect('a', { engine: 'sqlite', file })
  assert.equal(info.engine, 'sqlite')
  const out = await sql.query(
    'a',
    `create table people (id integer primary key, name text not null, photo blob);
     insert into people (name, photo) values ('Ann', x'0102'), ('Bo', null);
     create view names as select name from people;
     select id, name, photo, 1.5 as n from people order by id;`,
  )
  assert.equal(out.error, undefined)
  assert.deepEqual(
    out.results.map((r) => r.command ?? r.columns.join(',')),
    ['CREATE', 'INSERT', 'CREATE', 'id,name,photo,n'],
  )
  assert.equal(out.results[1].affected, 2)
  assert.deepEqual(out.results[3].rows, [
    [1, 'Ann', '0x0102', 1.5],
    [2, 'Bo', null, 1.5],
  ])
  assert.deepEqual(await sql.tables('a'), [
    { schema: 'main', name: 'names', view: true },
    { schema: 'main', name: 'people', view: false },
  ])
  const cols = await sql.columns('a', 'main', 'people')
  assert.deepEqual(
    cols.map((c) => [c.name, c.key, c.nullable]),
    [
      ['id', true, true],
      ['name', false, false],
      ['photo', false, true],
    ],
  )
})

test('SQLite: an error stops the run and keeps earlier results; rows are capped', async () => {
  const out = await sql.query('a', 'select 1; select * from nowhere; select 2')
  assert.equal(out.results.length, 1)
  assert.match(out.error ?? '', /no such table: nowhere/)
  const big = await sql.query('a', 'with recursive n(i) as (select 1 union all select i + 1 from n where i < 20000) select i from n')
  assert.equal(big.results[0].rows.length, 10000)
  assert.equal(big.results[0].truncated, true)
})

test('SQLite: cancelling stops a long query and the connection still works', async () => {
  const running = sql.query('a', 'with recursive n(i) as (select 1 union all select i + 1 from n) select count(*) from n')
  await new Promise((r) => setTimeout(r, 200))
  await sql.cancel('a')
  const out = await running
  assert.match(out.error ?? '', /cancelled/)
  const again = await sql.query('a', 'select count(*) from people')
  assert.deepEqual(again.results[0].rows, [[2]])
})

test('SQLite: a missing file is an error', async () => {
  await assert.rejects(sql.connect('b', { engine: 'sqlite', file: path.join(dir, 'missing.db') }), /there's no file/)
})
