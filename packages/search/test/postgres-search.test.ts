import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '@aptv2/db/test-helpers'
import { buildSeedUnits, minimalUnit, ProcessedUnitDataSchema, SOURCE_ID_SEPARATOR, type ParsedQuery } from '@aptv2/schema'
import { seedNeighborhoods, upsertProcessedUnits } from '@aptv2/pipeline'
import { createSearchService } from '../src/index'
import { parseQueryKeywords } from '../src/keyword-parse'

const NOW = new Date('2026-08-27T12:00:00.000Z')

let pool: Pool
// Keyword rung only — tests never hit the Anthropic API.
const service = () =>
  createSearchService(() => pool, { parse: async (raw) => parseQueryKeywords(raw) })

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await resetTestDb(pool)
  await seedNeighborhoods(pool)
  await upsertProcessedUnits(pool, buildSeedUnits(NOW))
})
afterAll(async () => {
  await pool.end()
})

describe('postgres SearchService', () => {
  it('answers the canonical demo query from SQL', async () => {
    const r = await service().search(
      'pet friendly 2br under $2400 near Lake Eola with in-unit laundry',
    )
    expect(r.totalCount).toBe(2) // Eola Commons B1 + Eola North 2/2
    expect(r.listings[0]!.propertyName).toBe('Eola Commons')
    for (const l of r.listings) {
      expect(l.beds).toBeGreaterThanOrEqual(2)
      expect(l.price === null || l.price <= 2400).toBe(true)
      expect(l.amenities).toContain('pet friendly')
      expect(l.amenities).toContain('in-unit laundry')
    }
    expect(r.timing.corpus).toBe(26)
    expect(r.timing.searchMs).toBeGreaterThanOrEqual(0)
  })

  it('collapses the cross-platform duplicate to one card with alsoListedOn', async () => {
    const r = await service().search('1 bed')
    const ridgewood = r.listings.filter((l) => l.propertyName === 'Ridgewood House')
    expect(ridgewood).toHaveLength(1)
    expect(ridgewood[0]!.price).toBe(1775)
    expect(ridgewood[0]!.platform).toBe('appfolio')
    expect(ridgewood[0]!.alsoListedOn).toEqual([{ platform: 'rentcafe', price: 1845 }])
  })

  it('ranks price-undisclosed listings last, never drops them', async () => {
    const r = await service().search('3 bed')
    expect(r.listings.length).toBeGreaterThanOrEqual(2)
    const last = r.listings[r.listings.length - 1]!
    expect(last.propertyName).toBe('Baldwin Harbor Flats')
    expect(last.price).toBeNull()
  })

  it('empty query returns the whole active corpus, collapsed', async () => {
    const r = await service().search('')
    expect(r.timing.corpus).toBe(26)
    expect(r.totalCount).toBe(25) // 26 minus the collapsed duplicate
  })

  it('reports corpus split by provenance and caps the page', async () => {
    const r = await service().search('')
    expect(r.timing.corpusSeed).toBe(26)
    expect(r.timing.corpusScraped).toBe(0) // this suite seeds only demo data
    expect(r.timing.corpus).toBe(r.timing.corpusSeed + r.timing.corpusScraped)
    expect(r.listings.length).toBeLessThanOrEqual(500)
  })

  it('applies shortTerm=false as a hard filter', async () => {
    const p: ParsedQuery = {
      ...parseQueryKeywords(''),
      shortTerm: false,
    }
    const svc = createSearchService(() => pool, { parse: async () => p })
    const r = await svc.search('anything')
    // Camellia is the only seed with short_term_ok=false → lease_term 'long';
    // everything else is 'unknown', which also satisfies "not short-term-ok".
    expect(r.totalCount).toBeGreaterThan(0)
    for (const l of r.listings) expect(l.shortTermOk).toBe(false)
  })

  it('applies furnished=false as a hard filter without dropping furnished-NULL rows', async () => {
    // The seed corpus has no unit with furnished: "furnished" — every row
    // maps to `furnished: false` in the Listing (row.furnished === true).
    // furnished:false must therefore match the whole collapsed corpus, and
    // furnished:true must match nothing (regression: `l.furnished = $3`
    // is NULL, not TRUE, for unknown-furnished rows, silently dropping them).
    const falseP: ParsedQuery = { ...parseQueryKeywords(''), furnished: false }
    const trueP: ParsedQuery = { ...parseQueryKeywords(''), furnished: true }
    const falseSvc = createSearchService(() => pool, { parse: async () => falseP })
    const trueSvc = createSearchService(() => pool, { parse: async () => trueP })
    const falseResult = await falseSvc.search('anything')
    const trueResult = await trueSvc.search('anything')
    expect(falseResult.totalCount).toBe(25) // whole collapsed corpus
    for (const l of falseResult.listings) expect(l.furnished).toBe(false)
    expect(trueResult.totalCount).toBe(0)
  })

  it('getListing maps the Camellia detail faithfully', async () => {
    const l = await service().getListing('seed___u0001')
    expect(l).not.toBeNull()
    expect(l!.propertyName).toBe('The Camellia at Lake Eola')
    expect(l!.trueCost).toEqual({
      advertisedMonthly: 1895,
      concessionLabel: '6 wk free ÷ 13 mo',
      concessionMonthly: 202,
      netEffectiveMonthly: 1693,
      moveInFees: [
        { label: 'Application fee', amount: 75 },
        { label: 'Admin fee', amount: 250 },
        { label: 'Security deposit (refundable)', amount: 500 },
        { label: 'Pet deposit', amount: 300 },
      ],
    })
    expect(l!.events).toHaveLength(4)
    expect(l!.provenance).toBe('seed')
    // Regression: availableDate must come back as the plain calendar date
    // the DB stored, not shifted by a UTC re-projection of a local-midnight
    // JS Date. Camellia's seed sets available_on = NOW + 12 days.
    expect(l!.availableDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(l!.availableDate).toBe('2026-09-08')
    // Seeded 47 days before the frozen NOW, but the service measures from
    // the real clock — assert the floor, not an exact value.
    expect(l!.daysOnMarket).toBeGreaterThanOrEqual(47)
  })

  it('logs every search to search_logs', async () => {
    const before = (await pool.query('SELECT count(*)::int AS n FROM search_logs')).rows[0].n
    await service().search('2br in baldwin park')
    const after = (await pool.query('SELECT count(*)::int AS n FROM search_logs')).rows[0].n
    expect(after).toBe(before + 1)
    const { rows } = await pool.query(
      'SELECT raw_query, parse_source, result_count FROM search_logs ORDER BY id DESC LIMIT 1',
    )
    expect(rows[0].raw_query).toBe('2br in baldwin park')
    expect(rows[0].parse_source).toBe('fallback')
    expect(rows[0].result_count).toBeGreaterThanOrEqual(1)
  })

  it('falls open to FTS for unrecognized terms and ranks by text relevance', async () => {
    const r = await service().search('rooftop coworking')
    expect(r.parsed.failedOpen).toBe(true)
    expect(r.parsed.residualText).toBe('rooftop coworking')
    // plainto_tsquery ANDs terms: all three Vue Downtown units have
    // "rooftop" in community amenities, but only the 1br and 2br also have
    // "coworking" — the studio doesn't, so it's excluded. 2 is correct, not 3.
    expect(r.totalCount).toBe(2)
    for (const l of r.listings) expect(l.propertyName).toBe('The Vue Downtown')
    expect(r.listings[0]!.score.textRelevance).toBeGreaterThan(0)
  })

  // Last: inserts an extra listing, which would otherwise shift the
  // corpus/totalCount assertions the earlier tests depend on.
  it('labels a net-effective discount without a structured concession as "Special rate"', async () => {
    const specialRateUnit = ProcessedUnitDataSchema.parse({
      ...minimalUnit(),
      source_id: `entrata${SOURCE_ID_SEPARATOR}special-rate-test`,
      platform: 'entrata',
      collapse_key: 'entrata:special-rate-test',
      liberal_dedup_cluster: 'orlando:special-rate-test-unit',
      source_url: 'https://example.com/special-rate-test',
      data_provenance: 'scraped',
      property_name: 'Special Rate Fixture',
      address_line1: '1 Special Rate Way',
      city: 'Orlando', state: 'FL', zip: '32801',
      neighborhood: 'Lake Eola Heights',
      latitude: 28.5462, longitude: -81.3708,
      beds: 1, baths: 1,
      advertised_rent_cents: 150000,
      price_level: 'unit', is_price_transparent: true,
      // Deterministic "special rate" fact (no LLM-parsed concession record):
      // net_effective_monthly_cents set, concession jsonb stays null.
      net_effective_monthly_cents: 130000,
      concession_type: 'other',
      concession_text_raw: 'Special rate $1300/mo (advertised $1500/mo)',
      first_seen_at: NOW.toISOString(), last_confirmed_at: NOW.toISOString(),
    })
    await upsertProcessedUnits(pool, [specialRateUnit])
    const l = await service().getListing('entrata___special-rate-test')
    expect(l).not.toBeNull()
    expect(l!.trueCost).not.toBeNull()
    expect(l!.trueCost!.concessionLabel).toBe('Special rate')
    expect(l!.trueCost!.advertisedMonthly).toBe(1500)
    expect(l!.trueCost!.concessionMonthly).toBe(200)
    expect(l!.trueCost!.netEffectiveMonthly).toBe(1300)
  })
})
