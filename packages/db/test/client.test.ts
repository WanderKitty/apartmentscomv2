import { describe, it, expect, afterAll } from 'vitest'
import { Pool } from 'pg'

describe('client', () => {
  it('connects to the test database', async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const { rows } = await pool.query('SELECT 1 AS one')
    expect(rows[0].one).toBe(1)
    await pool.end()
  })

  it('getPool throws without DATABASE_URL', async () => {
    const { getPool, closePool } = await import('../src/client')
    const saved = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    await closePool()
    expect(() => getPool()).toThrow('DATABASE_URL')
    process.env.DATABASE_URL = saved
  })
})
