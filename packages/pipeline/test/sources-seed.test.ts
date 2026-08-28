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

  it('marks all seeded sources enabled — every known embedded shape (v1, v2, rentpress) now has an extractor', () => {
    const byName = Object.fromEntries(SOURCES_SEED.map((s) => [s.name, s.enabled]))
    expect(byName['Current Orlando']).toBe(true)
    expect(byName['Society Orlando']).toBe(true)
    expect(byName['Aperture']).toBe(true)
    expect(byName['Knightsbridge at Stoneybrook']).toBe(true)
  })

  it('seeds idempotently by website_url, including the enabled flag', async () => {
    const first = await seedSources(pool)
    expect(first).toBe(SOURCES_SEED.length)
    await seedSources(pool)
    const { rows } = await pool.query(`SELECT name, enabled FROM sources ORDER BY name`)
    expect(rows.length).toBe(SOURCES_SEED.length)
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.enabled]))
    expect(byName['Current Orlando']).toBe(true)
    expect(byName['Aperture']).toBe(true)
    expect(byName['Knightsbridge at Stoneybrook']).toBe(true)
  })

  it('an ops-decided manual disable survives a reseed (ON CONFLICT must not overwrite enabled)', async () => {
    await seedSources(pool)
    await pool.query(`UPDATE sources SET enabled = false WHERE name = 'Current Orlando'`)
    await seedSources(pool)
    try {
      const { rows } = await pool.query(`SELECT enabled FROM sources WHERE name = 'Current Orlando'`)
      expect(rows[0].enabled).toBe(false)
    } finally {
      // This test DB is shared across the whole run (M8c) — restore the
      // seed's own default so a later suite in the same run never inherits
      // a disabled source left over from this test's assertion setup.
      await pool.query(`UPDATE sources SET enabled = true WHERE name = 'Current Orlando'`)
    }
  })
})
