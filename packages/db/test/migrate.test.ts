import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runMigrations } from '../src/migrate'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
})
afterAll(async () => {
  await pool.end()
})

describe('runMigrations', () => {
  it('applies pending .sql files in order, once, transactionally', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mig-'))
    await writeFile(path.join(dir, '0001_a.sql'), 'CREATE TABLE mig_a (id int);')
    await writeFile(path.join(dir, '0002_b.sql'), 'CREATE TABLE mig_b (id int);')

    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    const first = await runMigrations(pool, dir)
    expect(first).toEqual(['0001_a.sql', '0002_b.sql'])

    const second = await runMigrations(pool, dir)
    expect(second).toEqual([])

    const { rows } = await pool.query(
      `SELECT filename FROM schema_migrations ORDER BY filename`,
    )
    expect(rows.map((r) => r.filename)).toEqual(['0001_a.sql', '0002_b.sql'])
  })

  it('rolls back a failing migration atomically', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mig-'))
    await writeFile(
      path.join(dir, '0001_bad.sql'),
      'CREATE TABLE mig_c (id int); SELECT nope_not_a_function();',
    )
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await expect(runMigrations(pool, dir)).rejects.toThrow('0001_bad.sql')
    const { rows } = await pool.query(
      `SELECT to_regclass('public.mig_c') AS t`,
    )
    expect(rows[0].t).toBeNull()
  })
})
