import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '../src/test-helpers.js'

let pool: Pool
beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await resetTestDb(pool)
})
afterAll(async () => {
  await pool.end()
})

describe('sources + raw_snapshots schema', () => {
  it('round-trips a source row with defaults', async () => {
    const { rows } = await pool.query(
      `INSERT INTO sources (platform, name, website_url)
       VALUES ('rentcafe', 'The Vue at Lake Eola', 'https://example.com/vue')
       RETURNING *`,
    )
    const s = rows[0]
    expect(s.enabled).toBe(true)
    expect(s.failure_streak).toBe(0)
    expect(Number(s.rate_limit_rps)).toBe(1)
    expect(s.endpoint_config).toEqual({})
  })

  it('rejects unknown platform values', async () => {
    await expect(
      pool.query(
        `INSERT INTO sources (platform, name, website_url)
         VALUES ('zillow', 'Nope', 'https://example.com/nope')`,
      ),
    ).rejects.toThrow(/violates check constraint/)
  })

  it('stores a raw snapshot linked to a source', async () => {
    const { rows: srcRows } = await pool.query(
      `SELECT id FROM sources LIMIT 1`,
    )
    const { rows } = await pool.query(
      `INSERT INTO raw_snapshots (source_id, content_hash, payload)
       VALUES ($1, 'abc123', '{"units": []}'::jsonb)
       RETURNING *`,
      [srcRows[0].id],
    )
    expect(rows[0].processing_status).toBe('pending')
    expect(rows[0].payload).toEqual({ units: [] })
  })

  it('has postgis available', async () => {
    const { rows } = await pool.query(`SELECT PostGIS_Version() AS v`)
    expect(rows[0].v).toBeTruthy()
  })
})
