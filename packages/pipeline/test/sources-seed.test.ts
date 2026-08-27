import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '@aptv2/db/test-helpers'
import { SOURCES_SEED, seedSources } from '../src/sources-seed'

let pool: Pool
beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await resetTestDb(pool)
})
afterAll(async () => {
  await pool.end()
})

describe('sources seed', () => {
  it('has 1-5 entrata sources with complete endpoint_config', () => {
    expect(SOURCES_SEED.length).toBeGreaterThanOrEqual(1)
    expect(SOURCES_SEED.length).toBeLessThanOrEqual(5)
    for (const s of SOURCES_SEED) {
      expect(s.platform).toBe('entrata')
      expect(s.endpoint_config.endpoint_url).toMatch(/^https:\/\//)
      const p = s.endpoint_config.property
      expect(p.city).toBe('Orlando')
      expect(p.latitude).toBeGreaterThan(27)
      expect(p.longitude).toBeLessThan(-80)
    }
  })

  it('seeds idempotently by website_url', async () => {
    const first = await seedSources(pool)
    expect(first).toBe(SOURCES_SEED.length)
    await seedSources(pool)
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM sources`)
    expect(rows[0].n).toBe(SOURCES_SEED.length)
  })
})
