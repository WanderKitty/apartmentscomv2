import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '@aptv2/db/test-helpers'
import { ProcessedUnitDataSchema } from '@aptv2/schema'
import { parseEntrataPayload, type SourceRow } from '@aptv2/scrapers'
import { createHaikuEnricher, extractSnapshot } from '../src/extract'

const payload = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../scrapers/fixtures/entrata-availability.json', import.meta.url)),
    'utf8',
  ),
)
const embeddedHtml = readFileSync(
  fileURLToPath(new URL('../../scrapers/fixtures/entrata-embedded.html', import.meta.url)),
  'utf8',
)
const embeddedPayload = JSON.parse(
  (embeddedHtml.match(/<script[^>]*id="jd-fp-data-script-app"[^>]*>([\s\S]*?)<\/script>/) ?? ['', ''])[1]!,
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
const EMBEDDED_SOURCE: SourceRow = {
  id: 2, platform: 'entrata', name: 'Society Fixture', website_url: 'https://societyorlando.com',
  endpoint_config: {
    endpoint_url: 'https://societyorlando.com/floorplans/',
    property: {
      name: 'Society Fixture', address_line1: '410 N Orange Ave', city: 'Orlando',
      state: 'FL', zip: '32801', latitude: 28.548, longitude: -81.379,
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
  const { rows: rows2 } = await pool.query(
    `INSERT INTO sources (platform, name, website_url) VALUES ('entrata', 'Society Fixture', 'https://societyorlando.com') RETURNING id`,
  )
  EMBEDDED_SOURCE.id = rows2[0].id
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

  // CRITICAL regression coverage: the embedded shape's `permalink` is
  // site-relative — before the fix, every one of these 137 units failed
  // ProcessedUnitDataSchema's `source_url: z.string().url()`.
  it('produces 137 schema-valid records from the embedded-shape fixture (regression: relative permalink must resolve, not fail schema)', async () => {
    const { units, failures } = await extractSnapshot(pool, {
      snapshot: { id: 50, source_id: EMBEDDED_SOURCE.id, payload: embeddedPayload },
      source: EMBEDDED_SOURCE, now: NOW, llm: null,
    })
    expect(failures).toEqual([])
    expect(units.length).toBe(137)
    for (const u of units) {
      ProcessedUnitDataSchema.parse(u)
      expect(u.source_url.startsWith('https://societyorlando.com/')).toBe(true)
      expect(u.platform).toBe('entrata')
    }
  })

  it('maps the source image into image_url for both payload shapes', async () => {
    const rest = await extractSnapshot(pool, {
      snapshot: { id: 60, source_id: SOURCE.id, payload },
      source: SOURCE, now: NOW, llm: null,
    })
    expect(rest.units[0]!.image_url).toBe(
      'https://www.currentorlando.com/wp-content/uploads/2025/12/Current-Orlando-Floorplan-Unit-S1.jpg',
    )
    const embedded = await extractSnapshot(pool, {
      snapshot: { id: 61, source_id: EMBEDDED_SOURCE.id, payload: embeddedPayload },
      source: EMBEDDED_SOURCE, now: NOW, llm: null,
    })
    expect(embedded.failures).toEqual([]) // the "|" in the svg path must survive z.string().url()
    const unit = embedded.units.find((u) => u.unit_number === '1822-B')!
    expect(unit.image_url).toBe(
      'https://societyorlando.com/assets/images/rent--by--bedroom|3-bed--d1_single1.svg',
    )
  })

  it('a non-http(s) image degrades to image_url null — never fails the unit', async () => {
    // Clone the embedded payload and poison one unit's thumbnail with a
    // scheme the schema (rightly) refuses for an <img src> sink.
    const poisoned = structuredClone(embeddedPayload)
    poisoned.units[0].thumbnail = { src: 'javascript:alert(1)' }
    const { units, failures } = await extractSnapshot(pool, {
      snapshot: { id: 62, source_id: EMBEDDED_SOURCE.id, payload: poisoned },
      source: EMBEDDED_SOURCE, now: NOW, llm: null,
    })
    expect(failures).toEqual([])
    expect(units.length).toBe(137)
    expect(units[0]!.image_url).toBeNull()
  })

  it('applies LLM enrichment when the enricher returns values, and caches by content hash', async () => {
    // units[12] (floorplan ID 2139, "The Three Balcony") is the fixture
    // unit that carries free text (banner "Limited Availability" + tags)
    // AND has no `rentspecial` of its own — the fixture's FIRST unit
    // ("The Studio") has no banner/disclaimer/description text, so the
    // enrichment-skip-when-no-free-text rule would skip it (per the
    // brief's fixture-content caveat); most of the other free-text-bearing
    // floorplans (e.g. "The Two", units[8]) also carry a discounted
    // special rate, which now deterministically wins as concession_type
    // "other" (see the dedicated special-rate test below) and would mask
    // the LLM-derived concession this test means to exercise.
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
    const enriched = first.units[12]!
    expect(enriched.source_id).toMatch(/2139$/)
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

  it('maps a discounted "special" rate deterministically as concession_type "other" (floorplan ID 2141, "The Four")', async () => {
    await pool.query('DELETE FROM extract_cache')
    const { units, failures } = await extractSnapshot(pool, {
      snapshot: { id: 5, source_id: SOURCE.id, payload },
      source: SOURCE, now: NOW, llm: null,
    })
    expect(failures).toEqual([])
    const theFour = units[13]! // 14th floorplan record: ID 2141, rent $1150 / special $850
    expect(theFour.source_id).toMatch(/2141$/)
    expect(theFour.advertised_rent_cents).toBe(115000) // unchanged — the advertised (base) rent
    expect(theFour.net_effective_monthly_cents).toBe(85000) // the special rate
    expect(theFour.concession_type).toBe('other')
    expect(theFour.concession_text_raw).toBe('Special rate $850/mo (advertised $1150/mo)')
  })

  it('caches a legitimately-null enrichment result too, so the LLM is not re-sent the same text', async () => {
    await pool.query('DELETE FROM extract_cache')
    const nullEnricher = vi.fn(async () => null)
    const first = await extractSnapshot(pool, {
      snapshot: { id: 6, source_id: SOURCE.id, payload },
      source: SOURCE, now: NOW, llm: nullEnricher,
    })
    expect(first.failures).toEqual([])
    const callsAfterFirst = nullEnricher.mock.calls.length
    expect(callsAfterFirst).toBeGreaterThanOrEqual(1) // floorplans 8-14 all carry some free text (banner/tags)
    // Confirm the cached rows really are a stored JSON null, not absent.
    const { rows } = await pool.query(`SELECT extracted FROM extract_cache`)
    expect(rows.length).toBe(callsAfterFirst)
    for (const row of rows) expect(row.extracted).toBeNull()

    await extractSnapshot(pool, {
      snapshot: { id: 7, source_id: SOURCE.id, payload },
      source: SOURCE, now: NOW, llm: nullEnricher,
    })
    expect(nullEnricher.mock.calls.length).toBe(callsAfterFirst) // second run: all cache HITs, no new calls
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

describe('createHaikuEnricher', () => {
  it('returns null without ANTHROPIC_API_KEY', () => {
    const saved = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      expect(createHaikuEnricher()).toBeNull()
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved
    }
  })
})

describe('enrichment guard: zero/absent lease term (prod incident 2026-08-28)', () => {
  it('a concession with leaseMonths 0 is ignored — the unit still lands, math stays finite', async () => {
    const payload = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../scrapers/fixtures/entrata-availability.json', import.meta.url)),
        'utf8',
      ),
    )
    await pool.query('DELETE FROM extract_cache')
    const badEnricher = async () => ({
      pets_allowed: 'not_mentioned' as const,
      concession_text: '1 month free!',
      concession: { kind: 'free_months' as const, months: 1, leaseMonths: 0 },
      furnished: null,
      short_term_ok: null,
      summary: null,
    })
    const { units, failures } = await extractSnapshot(pool, {
      snapshot: { id: 90, source_id: SOURCE.id, payload },
      source: SOURCE, now: NOW, llm: badEnricher,
    })
    expect(failures).toEqual([])
    expect(units.length).toBeGreaterThanOrEqual(1)
    for (const u of units) {
      expect(u.net_effective_monthly_cents === null || Number.isFinite(u.net_effective_monthly_cents)).toBe(true)
      expect(u.concession_applies_lease_months).toBeNull()
      expect(u.concession_type === 'none' || u.concession_type === 'not_mentioned' || u.concession_type === 'other').toBe(true)
    }
    // The concession TEXT still survives as a fact for display.
    expect(units.some((u) => u.concession_text_raw === '1 month free!')).toBe(true)
  })
})

describe('enrichment concurrency', () => {
  it('enriches units with distinct texts concurrently, bounded at 5', async () => {
    await pool.query('DELETE FROM extract_cache')
    let inFlight = 0
    let maxInFlight = 0
    const enricher = vi.fn(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 25))
      inFlight--
      return null
    })
    const { failures } = await extractSnapshot(pool, {
      snapshot: { id: 95, source_id: SOURCE.id, payload },
      source: SOURCE, now: NOW, llm: enricher,
    })
    expect(failures).toEqual([])
    expect(enricher.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(maxInFlight).toBeGreaterThanOrEqual(2)
    expect(maxInFlight).toBeLessThanOrEqual(5)
  })

  it('units sharing identical texts still produce one enrichment call each', async () => {
    await pool.query('DELETE FROM extract_cache')
    const enricher = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 25))
      return null
    })
    const { failures } = await extractSnapshot(pool, {
      snapshot: { id: 96, source_id: EMBEDDED_SOURCE.id, payload: embeddedPayload },
      source: EMBEDDED_SOURCE, now: NOW, llm: enricher,
    })
    expect(failures).toEqual([])
    const uniqueTexts = new Set(
      parseEntrataPayload(embeddedPayload)
        .map((u) => [...u.amenityTexts, ...u.marketingTexts])
        .filter((ts) => ts.some((t) => t.trim()))
        .map((ts) => JSON.stringify(ts)),
    )
    expect(enricher.mock.calls.length).toBe(uniqueTexts.size)
  })
})
