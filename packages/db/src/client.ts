import pg from 'pg'

let pool: pg.Pool | undefined

export function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    pool = new pg.Pool({ connectionString: url })
  }
  return pool
}

export async function closePool(): Promise<void> {
  await pool?.end()
  pool = undefined
}
