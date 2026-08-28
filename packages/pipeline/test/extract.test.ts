import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '@aptv2/db/test-helpers'
import { ProcessedUnitDataSchema } from '@aptv2/schema'
import { parseEntrataPayload, sha256Json, type SourceRow } from '@aptv2/scrapers'
import * as scrapersModule from '@aptv2/scrapers'
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
const embeddedV2Html = readFileSync(
  fileURLToPath(new URL('../../scrapers/fixtures/entrata-embedded-v2.html', import.meta.url)),
  'utf8',
)
function decodeV2Entities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}
const embeddedV2Payload = JSON.parse(decodeV2Entities(embeddedV2Html.match(/:floor_plans='([^']*)'/)![1]!))

const rentpressHtml = readFileSync(
  fileURLToPath(new URL('../../scrapers/fixtures/entrata-rentpress.html', import.meta.url)),
  'utf8',
)
const rentpressPayload = JSON.parse(decodeV2Entities(rentpressHtml.match(/data-floorplans='([^']*)'/)![1]!))

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
const APERTURE_SOURCE: SourceRow = {
  id: 3, platform: 'entrata', name: 'Aperture Fixture', website_url: 'https://apertureorlando.com',
  endpoint_config: {
    endpoint_url: 'https://apertureorlando.com/floor-plans/',
    property: {
      name: 'Aperture Fixture', address_line1: '12727 E Colonial Dr', city: 'Orlando',
      state: 'FL', zip: '32826', latitude: 28.565, longitude: -81.189,
    },
  },
  robots_policy: null, rate_limit_rps: 1,
}
const KNIGHTSBRIDGE_SOURCE: SourceRow = {
  id: 4, platform: 'entrata', name: 'Knightsbridge Fixture', website_url: 'https://www.liveatknightsbridge.com',
  endpoint_config: {
    endpoint_url: 'https://www.liveatknightsbridge.com/floor-plans/',
    property: {
      name: 'Knightsbridge Fixture', address_line1: '2802 Cheval St', city: 'Orlando',
      state: 'FL', zip: '32828', latitude: 28.514, longitude: -81.178,
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
  const { rows: rows3 } = await pool.query(
    `INSERT INTO sources (platform, name, website_url) VALUES ('entrata', 'Aperture Fixture', 'https://apertureorlando.com') RETURNING id`,
  )
  APERTURE_SOURCE.id = rows3[0].id
  const { rows: rows4 } = await pool.query(
    `INSERT INTO sources (platform, name, website_url) VALUES ('entrata', 'Knightsbridge Fixture', 'https://www.liveatknightsbridge.com') RETURNING id`,
  )
  KNIGHTSBRIDGE_SOURCE.id = rows4[0].id
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

  it('produces 11 schema-valid records from the v2 embedded-shape fixture (Aperture), absolute source_urls', async () => {
    const { units, failures } = await extractSnapshot(pool, {
      snapshot: { id: 60, source_id: APERTURE_SOURCE.id, payload: embeddedV2Payload },
      source: APERTURE_SOURCE, now: NOW, llm: null,
    })
    expect(failures).toEqual([])
    expect(units.length).toBe(11)
    for (const u of units) {
      ProcessedUnitDataSchema.parse(u)
      expect(u.source_url.startsWith('https://apertureorlando.com/')).toBe(true)
      expect(u.platform).toBe('entrata')
    }
  })

  // CRITICAL regression coverage: the rentpress shape's unit_available_on
  // arrives as "M/D/YYYY" ("8/6/2026"), not ISO — before the normalization
  // shim, every one of these 37 units failed ProcessedUnitDataSchema's
  // `available_on: z.string().date()`.
  it('produces 37 schema-valid records from the rentpress embedded-shape fixture (Knightsbridge), absolute source_urls', async () => {
    const { units, failures } = await extractSnapshot(pool, {
      snapshot: { id: 70, source_id: KNIGHTSBRIDGE_SOURCE.id, payload: rentpressPayload },
      source: KNIGHTSBRIDGE_SOURCE, now: NOW, llm: null,
    })
    expect(failures).toEqual([])
    expect(units.length).toBe(37)
    for (const u of units) {
      ProcessedUnitDataSchema.parse(u)
      expect(u.source_url.startsWith('https://www.liveatknightsbridge.com/')).toBe(true)
      expect(u.platform).toBe('entrata')
      expect(u.available_on).toMatch(/^\d{4}-\d{2}-\d{2}$/) // normalized to ISO, not the source's "M/D/YYYY"
    }
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

describe('extractSnapshot: cache batch-fetch path', () => {
  it('a pre-existing cache row is honored via a single content_hash = ANY($1) prefetch, identically to the per-unit lookup', async () => {
    const rawUnits = parseEntrataPayload(payload, SOURCE.endpoint_config.endpoint_url)
    const withTextIndex = rawUnits.findIndex((u) => u.amenityTexts.length + u.marketingTexts.length > 0)
    expect(withTextIndex).toBeGreaterThanOrEqual(0)
    const texts = [...rawUnits[withTextIndex]!.amenityTexts, ...rawUnits[withTextIndex]!.marketingTexts]
    const preCachedHash = sha256Json({ texts, v: 2 })
    const preCached = {
      pets_allowed: 'allowed' as const, concession_text: null, concession: null,
      furnished: null, short_term_ok: null, summary: 'pre-cached',
    }
    const cacheStore = new Map<string, unknown>([[preCachedHash, preCached]])
    const enricherCalls: string[][] = []
    const enricher = async (calledTexts: string[]) => {
      enricherCalls.push(calledTexts)
      return {
        pets_allowed: 'not_allowed' as const, concession_text: null, concession: null,
        furnished: null, short_term_ok: null, summary: 'fresh',
      }
    }
    // A minimal fake pool that only understands a batched ANY($1) prefetch
    // and the per-miss insert — any other query shape (e.g. a per-unit
    // `content_hash = $1` lookup) fails the test, forcing the batch design.
    const fakePool = {
      async query(sql: string, params?: unknown[]) {
        if (/content_hash = ANY\(\$1\)/.test(sql)) {
          const hashes = params![0] as string[]
          const rows = hashes.filter((h) => cacheStore.has(h)).map((h) => ({ content_hash: h, extracted: cacheStore.get(h) }))
          return { rows }
        }
        if (/INSERT INTO extract_cache/.test(sql)) {
          const [hash, json] = params as [string, string]
          if (!cacheStore.has(hash)) cacheStore.set(hash, JSON.parse(json))
          return { rows: [] }
        }
        throw new Error(`extractSnapshot must batch-fetch extract_cache via one ANY($1) query; got: ${sql}`)
      },
    }
    const { units, failures } = await extractSnapshot(fakePool as unknown as Pool, {
      snapshot: { id: 99, source_id: SOURCE.id, payload }, source: SOURCE, now: NOW, llm: enricher,
    })
    expect(failures).toEqual([])
    const preCachedUnit = units[withTextIndex]!
    expect(preCachedUnit.pets_allowed).toBe('allowed') // served from the pre-seeded cache row, not the enricher
    expect(enricherCalls.some((t) => sha256Json({ texts: t, v: 2 }) === preCachedHash)).toBe(false)
  })

  it('a malformed unit (its hash computation throws) is a counted failure, not a whole-snapshot crash (review Important 5)', async () => {
    const rawUnits = parseEntrataPayload(payload, SOURCE.endpoint_config.endpoint_url)
    const targetIndex = rawUnits.findIndex((u) => u.amenityTexts.length + u.marketingTexts.length > 0)
    expect(targetIndex).toBeGreaterThanOrEqual(0)
    const targetTexts = [...rawUnits[targetIndex]!.amenityTexts, ...rawUnits[targetIndex]!.marketingTexts]
    const realSha256Json = scrapersModule.sha256Json
    const spy = vi.spyOn(scrapersModule, 'sha256Json').mockImplementation((value: unknown) => {
      const v = value as { texts?: unknown[] }
      const isTarget =
        Array.isArray(v?.texts) && v.texts.length === targetTexts.length && v.texts.every((t, i) => t === targetTexts[i])
      if (isTarget) throw new Error('boom: malformed unit')
      return realSha256Json(value)
    })
    try {
      const { units, failures } = await extractSnapshot(pool, {
        snapshot: { id: 100, source_id: SOURCE.id, payload }, source: SOURCE, now: NOW, llm: null,
      })
      // The ONE unit whose hash computation throws is counted as a failure
      // (like any other per-unit extraction error) — every OTHER unit in
      // the same snapshot still extracts, proving the failure didn't take
      // down the whole snapshot.
      expect(failures.length).toBe(1)
      expect(failures[0]!.error).toMatch(/boom: malformed unit/)
      expect(units.length).toBe(rawUnits.length - 1)
    } finally {
      spy.mockRestore()
    }
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

describe('spherexx: deterministic amenity taxonomy from source prose', () => {
  it('maps vendor amenity strings and pets text onto the filter taxonomy', async () => {
    const spherexxSource: SourceRow = {
      id: 77, platform: 'spherexx', name: 'Taxonomy Fixture', website_url: 'https://example.com/tax',
      endpoint_config: {
        endpoint_url: 'https://example.com/tax/floorplans/',
        mode: 'spherexx',
        property: { name: 'Taxonomy Fixture', address_line1: '1 Tax Way', city: 'Orlando', state: 'FL', zip: '32801', latitude: 28.54, longitude: -81.38 },
      },
      robots_policy: null, rate_limit_rps: 1,
    }
    const { rows: src } = await pool.query(
      `INSERT INTO sources (platform, name, website_url) VALUES ('spherexx','Taxonomy Fixture','https://example.com/tax') RETURNING id`,
    )
    spherexxSource.id = src[0]!.id
    const payload = {
      cards: [{
        fp: '99001', name: 'Tax Plan', minPriceDollars: 1500, maxPriceDollars: 1600,
        basePriceDollars: 1450, feeTotalDollars: 12.5, sqft: 700, beds: 1, baths: 1,
        unitsAvailable: 2, pricedOn: '20260828', detailPath: '/floorplans/1bedroom/tax-plan/',
        description: 'A lovely one bedroom with balcony access.',
      }],
      community: {
        description: 'A wonderful community with everything you need.',
        amenities: ['Large sparkling pool with sundecks', '24-Hour State-of-the-Art Fitness Center'],
        petsAllowed: true,
      },
    }
    const { units, failures } = await extractSnapshot(pool, {
      snapshot: { id: 900, source_id: spherexxSource.id, payload },
      source: spherexxSource, now: NOW, llm: null,
    })
    expect(failures).toEqual([])
    const u = units[0]!
    expect(u.community_amenities).toContain('pool')   // from "sparkling pool" prose
    expect(u.community_amenities).toContain('gym')    // from "Fitness Center"? no — keyword is gym/fitness
    expect(u.community_amenities).toContain('pet friendly') // from "Pets allowed"
    expect(u.unit_amenities).toContain('balcony')   // unit-level, not community
  })
})
