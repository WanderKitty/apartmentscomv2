import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '../src/test-helpers.js'

let pool: Pool
let unitId: number
let propertyId: number

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await resetTestDb(pool)
  const { rows: p } = await pool.query(
    `INSERT INTO properties (name, address_line1, city, state, zip, normalized_address, location)
     VALUES ('Ridgewood House', '412 E Ridgewood St', 'Orlando', 'FL', '32801',
             '412 e ridgewood st orlando fl 32801', ST_GeogFromText('POINT(-81.376 28.545)'))
     RETURNING id`,
  )
  propertyId = p[0].id
  const { rows: u } = await pool.query(
    `INSERT INTO units (property_id, kind, external_id, beds, baths, sqft)
     VALUES ($1, 'unit', '402', 1, 1, 705) RETURNING id`,
    [propertyId],
  )
  unitId = u[0].id
})
afterAll(async () => {
  await pool.end()
})

describe('migration 0005 serving fields', () => {
  it('accepts the new columns with sensible defaults', async () => {
    const { rows } = await pool.query(
      `INSERT INTO listings (unit_id, property_id, price_cents, collapse_key, dedup_cluster,
                             source_platform, source_external_id, source_url)
       VALUES ($1, $2, 177500, 'appfolio:ridgewood-402', 'orlando:412-e-ridgewood-st-402',
               'appfolio', 'ridgewood-402', 'https://example.com/appfolio/ridgewood-402')
       RETURNING *`,
      [unitId, propertyId],
    )
    expect(rows[0].provenance).toBe('seed')
    expect(rows[0].events).toEqual([])
    expect(rows[0].move_in_fees).toEqual([])
    expect(rows[0].concession).toBeNull()
  })

  it('enforces collapse_key uniqueness (the upsert identity)', async () => {
    await expect(
      pool.query(
        `INSERT INTO listings (unit_id, property_id, collapse_key)
         VALUES ($1, $2, 'appfolio:ridgewood-402')`,
        [unitId, propertyId],
      ),
    ).rejects.toThrow(/duplicate key/)
  })

  it('rejects out-of-enum provenance', async () => {
    await expect(
      pool.query(
        `INSERT INTO listings (unit_id, property_id, collapse_key, provenance)
         VALUES ($1, $2, 'x:y', 'guessed')`,
        [unitId, propertyId],
      ),
    ).rejects.toThrow(/provenance/)
  })
})
