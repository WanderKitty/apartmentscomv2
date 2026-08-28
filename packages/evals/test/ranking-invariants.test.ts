import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import type { Listing, ParsedQuery, SearchResult } from '@aptv2/schema'
import { createSearchService, parseQueryKeywords } from '@aptv2/search'
import { loadFullCorpus } from './corpus'

// Deterministic, key-free ranking regression (spec §8: "fixed query set,
// reviewed on weight changes"). Instead of brittle top-10 snapshots, these
// assert the invariants the ranking contract promises, over the full local
// corpus: 26 seed listings + the extracted REST fixture.

const NOW = new Date('2026-08-27T12:00:00.000Z')
// 'walk in closet' recognizes nothing → fail-open FTS over amenity/summary text.
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
  // Undisclosed price sorts last (spec §6.2)…
  const firstUnpriced = listings.findIndex((l) => l.price === null)
  if (firstUnpriced >= 0) {
    for (const l of listings.slice(firstUnpriced)) expect(l.price).toBeNull()
  }
  // …and within each segment scores are non-increasing.
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
      expect(new Set(clusters).size).toBe(clusters.length) // collapse: one card per cluster
      for (const l of r.listings) {
        const s = l.score
        for (const v of [s.textRelevance, s.freshness, s.trust, s.proximity]) {
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThanOrEqual(1)
        }
        // The §6.3 blend, weights pinned.
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

// The zero-results path promises: each hint drops exactly one filter, its
// suggestedQuery re-parses (keyword rung) back to the remaining filters, and
// its count is what that search actually returns. This pins COUNT_MATCHING_SQL
// against SEARCH_SQL drift — they are hand-duplicated WHERE clauses.
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
      expect([...counts].sort((a, b) => b - a)).toEqual(counts) // best unlock first
      for (const hint of r.relaxationHints) {
        expect(hint.count).toBeGreaterThan(0)
        const reparsed = parseQueryKeywords(hint.suggestedQuery)
        const followUp = await service().search(hint.suggestedQuery)
        // Round-trip: the suggested query must mean "the same search minus
        // that one filter" under the rung that will actually parse it.
        expect(filterFields(followUp.parsed)).toEqual(filterFields(reparsed))
        // Honest count: the advertised unlock equals what the search returns
        // (pre-collapse rows; hints count DB rows, cards may merge duplicates).
        expect(preCollapseRowCount(followUp)).toBe(hint.count)
      }
    })
  }
})
