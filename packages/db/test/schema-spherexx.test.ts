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

describe('migration 0011 spherexx platform', () => {
  it('accepts a spherexx source and still rejects an unknown platform', async () => {
    const { rows } = await pool.query(
      `INSERT INTO sources (platform, name, website_url)
       VALUES ('spherexx', 'Spherexx Fixture', 'https://example.com/spherexx') RETURNING platform`,
    )
    expect(rows[0]!.platform).toBe('spherexx')
    await expect(
      pool.query(
        `INSERT INTO sources (platform, name, website_url)
         VALUES ('myspace', 'Nope', 'https://example.com/nope')`,
      ),
    ).rejects.toThrow(/sources_platform_check/)
  })
})
