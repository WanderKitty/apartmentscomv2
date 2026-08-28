import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { createSearchService, parseQueryKeywords } from '@aptv2/search'
import { loadFullCorpus } from './corpus'

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
  await loadFullCorpus(pool, NOW)
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
