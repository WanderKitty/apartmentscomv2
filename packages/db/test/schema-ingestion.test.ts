import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '../src/test-helpers.js'

let pool: Pool
let sourceId: number
let unitId: number
let propertyId: number

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await resetTestDb(pool)
  const { rows: s } = await pool.query(
    `INSERT INTO sources (platform, name, website_url)
     VALUES ('rentcafe', 'Test Community', 'https://example.com/test') RETURNING id`,
  )
  sourceId = s[0].id
  const { rows: p } = await pool.query(
    `INSERT INTO properties (name, address_line1, city, state, zip, normalized_address, location)
     VALUES ('Test Community', '1 Test St', 'Orlando', 'FL', '32801',
             '1 test st orlando fl 32801', ST_GeogFromText('POINT(-81.38 28.54)'))
     RETURNING id`,
  )
  propertyId = p[0].id
  const { rows: u } = await pool.query(
    `INSERT INTO units (property_id, kind, external_id, beds, baths)
     VALUES ($1, 'unit', '101', 1, 1) RETURNING id`,
    [propertyId],
  )
  unitId = u[0].id
})
afterAll(async () => {
  await pool.end()
})

describe('migration 0006 ingestion fields', () => {
  it('accepts a listing with source_ref and rejects one without collapse_key', async () => {
    const { rows } = await pool.query(
      `INSERT INTO listings (unit_id, property_id, collapse_key, source_ref)
       VALUES ($1, $2, 'rentcafe:test-101', $3) RETURNING source_ref`,
      [unitId, propertyId, sourceId],
    )
    expect(rows[0].source_ref).toBe(sourceId)
    await expect(
      pool.query(`INSERT INTO listings (unit_id, property_id) VALUES ($1, $2)`, [unitId, propertyId]),
    ).rejects.toThrow(/collapse_key/)
  })

  it('extract_cache stores and conflicts on content_hash', async () => {
    await pool.query(
      `INSERT INTO extract_cache (content_hash, extracted) VALUES ('abc123', '{"pets_allowed":"allowed"}')`,
    )
    await pool.query(
      `INSERT INTO extract_cache (content_hash, extracted) VALUES ('abc123', '{"pets_allowed":"cats_only"}')
       ON CONFLICT (content_hash) DO NOTHING`,
    )
    const { rows } = await pool.query(`SELECT extracted FROM extract_cache WHERE content_hash = 'abc123'`)
    expect(rows[0].extracted.pets_allowed).toBe('allowed')
  })
})

describe('migration 0007 partial processing status', () => {
  it('accepts processing_status = partial and rejects an unrecognized value', async () => {
    const { rows } = await pool.query(
      `INSERT INTO raw_snapshots (source_id, content_hash, payload, processing_status)
       VALUES ($1, 'partial-hash', '{}', 'partial') RETURNING processing_status`,
      [sourceId],
    )
    expect(rows[0].processing_status).toBe('partial')
    await expect(
      pool.query(
        `INSERT INTO raw_snapshots (source_id, content_hash, payload, processing_status)
         VALUES ($1, 'bogus-hash', '{}', 'bogus')`,
        [sourceId],
      ),
    ).rejects.toThrow(/raw_snapshots_processing_status_check/)
  })
})
