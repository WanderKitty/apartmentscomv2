import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '@aptv2/db/test-helpers'
import { ProcessedUnitDataSchema } from '@aptv2/schema'
import type { SourceRow } from '@aptv2/scrapers'
import { extractSnapshot } from '../src/extract'

const payload = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../scrapers/fixtures/entrata-availability.json', import.meta.url)),
    'utf8',
  ),
)
const NOW = new Date('2026-08-27T12:00:00.000Z')
const SOURCE: SourceRow = {
  id: 1, platform: 'entrata', name: 'Fixture Community', website_url: 'https://example.com',
  endpoint_config: {
    endpoint_url: 'https://example.com/feed.json',
    property: {
      name: 'Fixture Community', address_line1: '1 Fixture St', city: 'Orlando',
      state: 'FL', zip: '32801', latitude: 28.54, longitude: -81.38,
    },
  },
  robots_policy: null, rate_limit_rps: 1,
}

let pool: Pool
beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await resetTestDb(pool)
  const { rows } = await pool.query(
    `INSERT INTO sources (platform, name, website_url) VALUES ('entrata', 'Fixture Community', 'https://example.com') RETURNING id`,
  )
  SOURCE.id = rows[0].id
})
afterAll(async () => {
  await pool.end()
})

describe('extractSnapshot', () => {
  it('produces schema-valid scraped records without any LLM (fail-open)', async () => {
    const { units, failures } = await extractSnapshot(pool, {
      snapshot: { id: 1, source_id: SOURCE.id, payload },
      source: SOURCE, now: NOW, llm: null,
    })
    expect(failures).toEqual([])
    expect(units.length).toBe(15) // 15 floorplans in the fixture
    for (const u of units) {
      ProcessedUnitDataSchema.parse(u)
      expect(u.data_provenance).toBe('scraped')
      expect(u.platform).toBe('entrata')
      expect(u.source_id.startsWith('entrata___')).toBe(true)
      expect(u.pets_allowed).toBe('not_mentioned') // LLM-less fields stay honest
      expect(u.property_name).toBe('Fixture Community')
      expect(u.latitude).toBeCloseTo(28.54, 3)
    }
  })

  it('applies LLM enrichment when the enricher returns values, and caches by content hash', async () => {
    // units[8] (floorplan ID 2133, "The Two") is the fixture unit that
    // carries free text (`banner: "Limited Availability"`) — the fixture's
    // FIRST unit ("The Studio") has no banner/disclaimer/description text,
    // so the enrichment-skip-when-no-free-text rule would skip it (per
    // the brief's fixture-content caveat), retargeting here instead.
    const enricher = vi.fn(async () => ({
      pets_allowed: 'allowed' as const,
      concession_text: '1 month free on 12-month leases',
      concession: { kind: 'free_months' as const, months: 1, leaseMonths: 12 },
      furnished: null,
      short_term_ok: null,
      summary: 'A fixture summary.',
    }))
    const first = await extractSnapshot(pool, {
      snapshot: { id: 2, source_id: SOURCE.id, payload },
      source: SOURCE, now: NOW, llm: enricher,
    })
    const enriched = first.units[8]!
    expect(enriched.source_id).toMatch(/2133$|the-two$/)
    expect(enriched.pets_allowed).toBe('allowed')
    expect(enriched.concession_type).toBe('free_months')
    expect(enriched.net_effective_monthly_cents).not.toBeNull()

    const callsAfterFirst = enricher.mock.calls.length
    expect(callsAfterFirst).toBeGreaterThanOrEqual(1)
    // Second run over the SAME payload: served from extract_cache, no new calls.
    await extractSnapshot(pool, {
      snapshot: { id: 3, source_id: SOURCE.id, payload },
      source: SOURCE, now: NOW, llm: enricher,
    })
    expect(enricher.mock.calls.length).toBe(callsAfterFirst)
  })

  it('a throwing enricher degrades to not_mentioned instead of failing the unit', async () => {
    await pool.query('DELETE FROM extract_cache')
    const { units, failures } = await extractSnapshot(pool, {
      snapshot: { id: 4, source_id: SOURCE.id, payload },
      source: SOURCE, now: NOW,
      llm: async () => { throw new Error('api down') },
    })
    expect(failures).toEqual([])
    expect(units[8]!.pets_allowed).toBe('not_mentioned')
  })
})
