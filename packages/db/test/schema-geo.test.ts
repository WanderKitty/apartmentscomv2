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

describe('geo entity schema', () => {
  it('stores a neighborhood polygon and finds a point inside it', async () => {
    await pool.query(
      `INSERT INTO neighborhoods (metro, name, aliases, boundary)
       VALUES ('orlando', 'Downtown', ARRAY['downtown', 'downtown orlando'],
         ST_GeogFromText('MULTIPOLYGON(((-81.40 28.53, -81.36 28.53, -81.36 28.56, -81.40 28.56, -81.40 28.53)))'))`,
    )
    const { rows } = await pool.query(
      `SELECT name FROM neighborhoods
       WHERE ST_Covers(boundary, ST_GeogFromText('POINT(-81.38 28.54)'))`,
    )
    expect(rows.map((r) => r.name)).toEqual(['Downtown'])
  })

  it('creates a property with location and unique normalized address', async () => {
    const insert = `INSERT INTO properties
        (name, address_line1, city, state, zip, normalized_address, location)
       VALUES ('The Vue', '150 E Robinson St', 'Orlando', 'FL', '32801',
               '150 e robinson st orlando fl 32801',
               ST_GeogFromText('POINT(-81.376 28.545)'))
       RETURNING id`
    const { rows } = await pool.query(insert)
    expect(rows[0].id).toBeGreaterThan(0)
    await expect(pool.query(insert)).rejects.toThrow(/duplicate key/)
  })

  it('creates a floorplan and a unit referencing it', async () => {
    const { rows: props } = await pool.query(`SELECT id FROM properties LIMIT 1`)
    const { rows: fp } = await pool.query(
      `INSERT INTO units (property_id, kind, external_id, name, beds, baths, sqft)
       VALUES ($1, 'floorplan', 'A2', 'A2', 2, 2, 1100) RETURNING id`,
      [props[0].id],
    )
    const { rows: unit } = await pool.query(
      `INSERT INTO units (property_id, kind, floorplan_id, external_id, name, beds, baths, sqft)
       VALUES ($1, 'unit', $2, '304', '#304', 2, 2, 1100) RETURNING *`,
      [props[0].id, fp[0].id],
    )
    expect(unit[0].floorplan_id).toBe(fp[0].id)
  })
})
