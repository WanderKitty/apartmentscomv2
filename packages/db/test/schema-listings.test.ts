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
     VALUES ('The Vue', '150 E Robinson St', 'Orlando', 'FL', '32801',
             '150 e robinson st orlando fl 32801', ST_GeogFromText('POINT(-81.376 28.545)'))
     RETURNING id`,
  )
  propertyId = p[0].id
  const { rows: u } = await pool.query(
    `INSERT INTO units (property_id, kind, external_id, beds, baths, sqft)
     VALUES ($1, 'floorplan', 'A2', 2, 2, 1100) RETURNING id`,
    [propertyId],
  )
  unitId = u[0].id
})
afterAll(async () => {
  await pool.end()
})

describe('listings schema', () => {
  it('inserts a listing and auto-generates the tsvector', async () => {
    const { rows } = await pool.query(
      `INSERT INTO listings
         (unit_id, property_id, location, price_cents, search_text)
       VALUES ($1, $2, ST_GeogFromText('POINT(-81.376 28.545)'), 185000,
               'Furnished two bedroom with pool view, walkable to Lake Eola')
       RETURNING *`,
      [unitId, propertyId],
    )
    expect(rows[0].status).toBe('active')
    expect(rows[0].price_is_starting_at).toBe(false)
    expect(rows[0].price_history).toEqual([])
    expect(rows[0].search_tsv).toContain('furnish')
  })

  it('matches FTS queries against search_tsv', async () => {
    const { rows } = await pool.query(
      `SELECT id FROM listings
       WHERE search_tsv @@ plainto_tsquery('english', 'furnished pool')`,
    )
    expect(rows.length).toBe(1)
  })

  it('finds listings within a radius', async () => {
    const { rows } = await pool.query(
      `SELECT id FROM listings
       WHERE ST_DWithin(location, ST_GeogFromText('POINT(-81.38 28.54)'), 2000)`,
    )
    expect(rows.length).toBe(1)
  })

  it('rejects invalid status values', async () => {
    await expect(
      pool.query(`UPDATE listings SET status = 'leased'`),
    ).rejects.toThrow(/violates check constraint/)
  })
})
