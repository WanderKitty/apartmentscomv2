import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import type { Listing, ParsedQuery, SearchResult } from '@aptv2/schema'
import { createSearchService, parseQueryKeywords } from '@aptv2/search'
import { loadFullCorpus } from './corpus'

const NOW = new Date('2026-08-27T12:00:00.000Z')
const QUERIES = ['', '1 bed', '2br', 'studio', 'under 2200', 'pool', '1br in thornton park', 'walk in closet']

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

const preCollapseRowCount = (r: SearchResult) =>
  r.listings.reduce((n, l) => n + 1 + l.alsoListedOn.length, 0)

function expectRankedOrder(listings: Listing[]) {
  const firstUnpriced = listings.findIndex((l) => l.price === null)
  if (firstUnpriced >= 0) {
    for (const l of listings.slice(firstUnpriced)) expect(l.price).toBeNull()
  }
  for (const segment of [listings.filter((l) => l.price !== null), listings.filter((l) => l.price === null)]) {
    for (let i = 1; i < segment.length; i++) {
      expect(segment[i]!.score.total).toBeLessThanOrEqual(segment[i - 1]!.score.total + 1e-9)
    }
  }
}

describe('ranking invariants over the fixed query set', () => {
  for (const q of QUERIES) {
    it(`"${q || '(empty)'}"`, async () => {
      const r = await service().search(q)
      expect(r.listings.length).toBeGreaterThan(0)
      expectRankedOrder(r.listings)
      const clusters = r.listings.map((l) => l.dedupCluster)
      expect(new Set(clusters).size).toBe(clusters.length)
      for (const l of r.listings) {
        const s = l.score
        for (const v of [s.textRelevance, s.freshness, s.trust, s.proximity]) {
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThanOrEqual(1)
        }
        expect(s.total).toBeCloseTo(0.35 * s.textRelevance + 0.3 * s.freshness + 0.25 * s.trust + 0.1 * s.proximity, 6)
      }
    })
  }

  it('a neighborhood query scores proximity for its results', async () => {
    const r = await service().search('1br in thornton park')
    expect(r.listings.length).toBeGreaterThan(0)
    expect(r.listings[0]!.score.proximity).toBeGreaterThan(0)
  })
})

describe('relaxation hints are honest', () => {
  const ZERO_RESULT_QUERIES = [
    '3 bed in thornton park under 2400',
    'studio in baldwin park with pool under 900',
  ]
  const filterFields = (p: ParsedQuery) => ({
    neighborhoods: [...p.neighborhoods].sort(),
    priceMax: p.priceMax,
    bedsMin: p.bedsMin,
    bedsMax: p.bedsMax,
    furnished: p.furnished,
    shortTerm: p.shortTerm,
    amenities: [...p.amenities].sort(),
  })

  for (const q of ZERO_RESULT_QUERIES) {
    it(`"${q}"`, async () => {
      const r = await service().search(q)
      expect(r.listings).toEqual([])
      expect(r.relaxationHints.length).toBeGreaterThan(0)
      expect(r.relaxationHints.length).toBeLessThanOrEqual(4)
      const counts = r.relaxationHints.map((h) => h.count)
      expect([...counts].sort((a, b) => b - a)).toEqual(counts)
      for (const hint of r.relaxationHints) {
        expect(hint.count).toBeGreaterThan(0)
        const reparsed = parseQueryKeywords(hint.suggestedQuery)
        const followUp = await service().search(hint.suggestedQuery)
        expect(filterFields(followUp.parsed)).toEqual(filterFields(reparsed))
        expect(preCollapseRowCount(followUp)).toBe(hint.count)
      }
    })
  }
})
