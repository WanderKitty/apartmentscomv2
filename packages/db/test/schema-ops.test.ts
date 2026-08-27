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

describe('ops tables', () => {
  it('records a scrape run', async () => {
    const { rows: src } = await pool.query(
      `INSERT INTO sources (platform, name, website_url)
       VALUES ('appfolio', 'Test Mgmt', 'https://test.appfolio.com/listings')
       RETURNING id`,
    )
    const { rows } = await pool.query(
      `INSERT INTO scrape_runs (source_id, status, listings_found, listings_changed)
       VALUES ($1, 'ok', 42, 3) RETURNING *`,
      [src[0].id],
    )
    expect(rows[0].listings_found).toBe(42)
  })

  it('logs a search and caches a parse', async () => {
    await pool.query(
      `INSERT INTO search_logs (raw_query, parsed_filters, parse_source, result_count)
       VALUES ('furnished downtown under 2k', '{"price_max": 2000}'::jsonb, 'llm', 17)`,
    )
    await pool.query(
      `INSERT INTO query_parses (normalized_query, parsed_filters)
       VALUES ('furnished downtown under 2k', '{"price_max": 2000}'::jsonb)`,
    )
    const { rows } = await pool.query(
      `SELECT parsed_filters FROM query_parses
       WHERE normalized_query = 'furnished downtown under 2k'`,
    )
    expect(rows[0].parsed_filters).toEqual({ price_max: 2000 })
  })

  it('enqueues an ambiguous dedup match for review', async () => {
    const { rows } = await pool.query(
      `INSERT INTO review_queue (kind, payload)
       VALUES ('dedup_match', '{"candidate_a": 1, "candidate_b": 2}'::jsonb)
       RETURNING status`,
    )
    expect(rows[0].status).toBe('pending')
  })
})
