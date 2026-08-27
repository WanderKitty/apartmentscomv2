import type pg from 'pg'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export async function runMigrations(
  pool: pg.Pool,
  dir: string,
): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  const { rows } = await pool.query('SELECT filename FROM schema_migrations')
  const done = new Set(rows.map((r) => r.filename))
  const applied: string[] = []
  for (const f of files) {
    if (done.has(f)) continue
    const sql = await readFile(path.join(dir, f), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [f],
      )
      await client.query('COMMIT')
      applied.push(f)
    } catch (e) {
      await client.query('ROLLBACK')
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`)
    } finally {
      client.release()
    }
  }
  return applied
}
