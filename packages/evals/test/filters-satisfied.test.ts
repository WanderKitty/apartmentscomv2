import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '@aptv2/db/test-helpers'
import { buildSeedUnits } from '@aptv2/schema'
import { seedNeighborhoods, upsertProcessedUnits, extractSnapshot } from '@aptv2/pipeline'
import type { SourceRow } from '@aptv2/scrapers'
import { createSearchService, parseQueryKeywords } from '@aptv2/search'

// Deterministic, key-free: every listing a search returns must satisfy every
// parsed hard filter (spec §6.2 — hard filters are never soft). Runs over the
// full local corpus: 26 seed listings + the REST fixture extracted with the
// LLM disabled.

const NOW = new Date('2026-08-27T12:00:00.000Z')
const QUERIES = [
  '1 bed',
  '2br under $2200',
  'studio',
  'pet friendly 2br',
  '3 bed',
  'pool gym 2 bed',
  '1br in thornton park',
  'under 1800',
]

let pool: Pool
const service = () =>
  createSearchService(() => pool, { parse: async (raw) => parseQueryKeywords(raw) })

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await resetTestDb(pool)
  await seedNeighborhoods(pool)
  await upsertProcessedUnits(pool, buildSeedUnits(NOW))
  const payload = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../scrapers/fixtures/entrata-availability.json', import.meta.url)),
      'utf8',
    ),
  )
  const { rows } = await pool.query(
    `INSERT INTO sources (platform, name, website_url, endpoint_config)
     VALUES ('entrata', 'Fixture Community', 'https://example.com',
             '{"endpoint_url":"https://example.com/feed.json","property":{"name":"Fixture Community","address_line1":"1 Fixture St","city":"Orlando","state":"FL","zip":"32801","latitude":28.54,"longitude":-81.38}}')
     RETURNING id`,
  )
  const source = (await pool.query(`SELECT * FROM sources WHERE id = $1`, [rows[0].id])).rows[0] as SourceRow
  const { units, failures } = await extractSnapshot(pool, {
    snapshot: { id: 1, source_id: source.id, payload },
    source,
    now: NOW,
    llm: null,
  })
  expect(failures).toEqual([])
  await upsertProcessedUnits(pool, units, { sourceRef: source.id })
})
afterAll(async () => {
  await pool.end()
})

describe('every result satisfies every parsed hard filter', () => {
  for (const q of QUERIES) {
    it(`"${q}"`, async () => {
      const r = await service().search(q)
      const p = r.parsed
      expect(r.timing.corpus).toBe(r.timing.corpusSeed + r.timing.corpusScraped)
      expect(r.timing.corpusScraped).toBeGreaterThan(0) // fixture corpus really loaded
      for (const l of r.listings) {
        if (p.bedsMin !== null) expect(l.beds).toBeGreaterThanOrEqual(p.bedsMin)
        if (p.bedsMax !== null) expect(l.beds).toBeLessThanOrEqual(p.bedsMax)
        if (p.priceMax !== null) expect(l.price === null || l.price <= p.priceMax).toBe(true)
        for (const a of p.amenities) expect(l.amenities).toContain(a)
        if (p.furnished !== null) expect(l.furnished).toBe(p.furnished)
        if (p.shortTerm !== null) expect(l.shortTermOk).toBe(p.shortTerm)
      }
    })
  }
})
