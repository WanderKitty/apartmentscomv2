import pg from 'pg'
import { fileURLToPath } from 'node:url'
import { runMigrations } from './migrate'

const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url))

export async function resetTestDb(pool: pg.Pool): Promise<void> {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await runMigrations(pool, migrationsDir)
}

/** Create dbName on the server at baseUrl if missing; return a URL pointing at it. */
export async function ensureDatabase(baseUrl: string, dbName: string): Promise<string> {
  const admin = new pg.Pool({ connectionString: baseUrl, max: 1 })
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
    if (!rowCount) await admin.query(`CREATE DATABASE "${dbName}"`)
  } catch (err) {
    if ((err as { code?: string }).code !== '42P04') throw err // 42P04: created concurrently
  } finally {
    await admin.end()
  }
  const url = new URL(baseUrl)
  url.pathname = `/${dbName}`
  return url.toString()
}

/** Drop-and-remigrate the database at url (for callers without their own pg dependency). */
export async function resetDatabaseAtUrl(url: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: url, max: 1 })
  try {
    await resetTestDb(pool)
  } finally {
    await pool.end()
  }
}

/**
 * Rewrite TEST_DATABASE_URL to a per-package database (`<base>_<suffix>`),
 * creating it on first use. Every package suite resets its database with
 * resetTestDb; giving each package its own database lets `pnpm -r test` run
 * packages in parallel without racing on DROP SCHEMA / CREATE EXTENSION.
 */
export async function usePerPackageTestDb(suffix: string): Promise<void> {
  const base = process.env.TEST_DATABASE_URL
  if (!base) return
  const dbName = `${new URL(base).pathname.slice(1)}_${suffix}`
  process.env.TEST_DATABASE_URL = await ensureDatabase(base, dbName)
}
