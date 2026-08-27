import type pg from 'pg'
import { fileURLToPath } from 'node:url'
import { runMigrations } from './migrate'

const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url))

export async function resetTestDb(pool: pg.Pool): Promise<void> {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await runMigrations(pool, migrationsDir)
}
