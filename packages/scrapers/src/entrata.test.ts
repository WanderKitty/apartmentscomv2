import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EntrataPayloadError, entrataAdapter, parseEntrataPayload } from './entrata'
import type { PoliteFetcher, SourceRow } from './index'

const restPayload = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/entrata-availability.json', import.meta.url)), 'utf8'),
)

const embeddedHtml = readFileSync(
  fileURLToPath(new URL('../fixtures/entrata-embedded.html', import.meta.url)),
  'utf8',
)

const embeddedV2Html = readFileSync(
  fileURLToPath(new URL('../fixtures/entrata-embedded-v2.html', import.meta.url)),
  'utf8',
)

const rentpressHtml = readFileSync(
  fileURLToPath(new URL('../fixtures/entrata-rentpress.html', import.meta.url)),
  'utf8',
)

const SOURCE: SourceRow = {
  id: 7,
  platform: 'entrata',
  name: 'Fixture Community',
  website_url: 'https://example.com',
  endpoint_config: {
    endpoint_url: 'https://example.com/feed.json',
    property: {
      name: 'Fixture Community', address_line1: '1 Fixture St', city: 'Orlando',
      state: 'FL', zip: '32801', latitude: 28.54, longitude: -81.38,
    },
  },
  robots_policy: null,
  rate_limit_rps: 1,
}

describe('parseEntrataPayload (golden, REST shape — Current Orlando fixture)', () => {
  // Called with a baseUrl, exactly as extract.ts calls it — required to
  // exercise the detailUrl absolutization (CRITICAL regression: relative
  // paths must resolve, not be passed straight into a `z.string().url()`
  // schema field downstream).
  const units = parseEntrataPayload(restPayload, SOURCE.endpoint_config.endpoint_url)

  it('parses all 15 floorplans with sane fields', () => {
    expect(units.length).toBe(15)
    for (const u of units) {
      expect(u.externalId).toBeTruthy()
      expect(u.beds).toBeGreaterThanOrEqual(0)
      expect(u.baths).toBeGreaterThanOrEqual(1)
      expect(u.rentCents === null || u.rentCents > 30000).toBe(true) // dollars→cents conversion sanity
      expect(u.unitNumber).toBeNull() // this endpoint has no per-unit granularity
    }
    expect(new Set(units.map((u) => u.externalId)).size).toBe(units.length)
  })

  it('maps a known floorplan (ID 2127, "The Studio") faithfully', () => {
    const studio = units[0]!
    expect(studio.externalId).toBe('annual-2127') // "annual" is the lease-term group's slug
    expect(studio.floorplanName).toBe('The Studio')
    expect(studio.beds).toBe(0)
    expect(studio.baths).toBe(1)
    expect(studio.sqft).toBe(433)
    expect(studio.rentCents).toBe(175000) // $1750 -> cents
    expect(studio.rentSpecialCents).toBeNull() // no rentspecial for this floorplan
    expect(studio.availableOn).toBeNull() // no availability field on this endpoint
    expect(studio.marketingTexts).toEqual([]) // banner/disclaimer/description all "" for this floorplan
    // Composed from fp.slug, not featured_image.link (which is the
    // image-attachment page, not the floorplan's own page).
    expect(studio.detailUrl).toBe('https://example.com/local-floor-plans/the-studio/')
  })

  it('carries free text and a discounted special rate (floorplan ID 2133, "The Two")', () => {
    const theTwo = units[8]!
    expect(theTwo.externalId).toBe('annual-2133')
    expect(theTwo.marketingTexts).toContain('Limited Availability')
    expect(theTwo.rentCents).toBe(135000) // $1350
    expect(theTwo.rentSpecialCents).toBe(126700) // $1267 special rate
  })

  it('throws a named error on a wrong-shaped payload', () => {
    expect(() => parseEntrataPayload({ nonsense: true })).toThrow(/Entrata/)
  })

  it('throws a named error when a required field is missing', () => {
    expect(() =>
      parseEntrataPayload([{ name: 'Annual', bedrooms: [[{ name: 'No ID here', unit_bathrooms: '1', unit_bedrooms: '1' }]] }]),
    ).toThrow(EntrataPayloadError)
  })
})

describe('parseEntrataPayload (golden, embedded shape — Society Orlando capture)', () => {
  const embeddedPayload = JSON.parse(
    (embeddedHtml.match(/<script[^>]*id="jd-fp-data-script-app"[^>]*>([\s\S]*?)<\/script>/) ?? ['', ''])[1]!,
  )
  const SOCIETY_ENDPOINT = 'https://societyorlando.com/floorplans/'
  const units = parseEntrataPayload(embeddedPayload, SOCIETY_ENDPOINT)

  it('parses all 137 units with sane fields, distinct per-unit external ids', () => {
    expect(units.length).toBe(137)
    for (const u of units) {
      expect(u.externalId).toBeTruthy()
      expect(u.beds).toBeGreaterThanOrEqual(0)
      expect(u.baths).toBeGreaterThanOrEqual(1)
      expect(u.rentCents === null || u.rentCents > 30000).toBe(true)
    }
    expect(new Set(units.map((u) => u.externalId)).size).toBe(units.length)
  })

  it('maps a known unit (apartment #1822-B) faithfully, with an absolute detailUrl', () => {
    const unit = units.find((u) => u.unitNumber === '1822-B')!
    expect(unit.externalId).toBe('8756877')
    expect(unit.floorplanName).toBe('Rent-By-Bedroom | 3 Bed - D1')
    expect(unit.beds).toBe(3)
    expect(unit.baths).toBe(3)
    expect(unit.sqft).toBe(484)
    expect(unit.rentCents).toBe(130500) // $1305 -> cents
    expect(unit.rentSpecialCents).toBeNull() // this shape has no separate special-rate field
    expect(unit.availableOn).toBe('2024-03-18')
    expect(unit.marketingTexts).toContain(
      'Specials Available, Up to 2 Months Free on Select Homes! Contact Us For More Details.',
    )
    // CRITICAL regression: permalink ("/floorplans/unit-.../") is site-relative
    // in the real capture — must resolve against the base, not pass through raw.
    expect(unit.detailUrl).toBe(
      'https://societyorlando.com/floorplans/unit-4fad4c8f34c45ca364a20e1c2f67ef67/',
    )
  })
})

describe('parseEntrataPayload (golden, embedded v2 shape — Aperture capture)', () => {
  // Same convention as the v1 embedded block above: re-derive the payload
  // from the raw HTML the way entrataAdapter.fetch's extractEmbeddedJson
  // does internally (that function isn't exported), so this test exercises
  // the real entity-encoded attribute + decode, not a pre-cleaned fixture.
  const V2_EMBEDDED_ATTR_RE = /:floor_plans='([^']*)'/
  function decodeHtmlEntities(s: string): string {
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
  const v2Payload = JSON.parse(decodeHtmlEntities(embeddedV2Html.match(V2_EMBEDDED_ATTR_RE)![1]!))
  const APERTURE_ENDPOINT = 'https://apertureorlando.com/floor-plans/'
  const units = parseEntrataPayload(v2Payload, APERTURE_ENDPOINT)

  it('parses all 11 floorplans with sane fields, distinct external ids', () => {
    expect(units.length).toBe(11)
    for (const u of units) {
      expect(u.externalId).toBeTruthy()
      expect(u.beds).toBeGreaterThanOrEqual(0)
      expect(u.baths).toBeGreaterThanOrEqual(1)
      expect(u.rentCents === null || u.rentCents > 30000).toBe(true)
      expect(u.unitNumber).toBeNull() // per-floorplan granularity, not per physical unit
    }
    expect(new Set(units.map((u) => u.externalId)).size).toBe(units.length)
  })

  it('maps a known floorplan (post_id 2678, "2BR/2BA – B1") faithfully', () => {
    const unit = units.find((u) => u.externalId === '2678')!
    expect(unit.floorplanName).toBe('2BR/2BA – B1') // en dash, double-escaped in the raw HTML
    expect(unit.beds).toBe(2)
    expect(unit.baths).toBe(2)
    expect(unit.sqft).toBe(834)
    expect(unit.rentCents).toBe(137900) // $1379 -> cents
    expect(unit.rentSpecialCents).toBeNull() // no distinct discounted-rate field on this shape
    expect(unit.availableOn).toBe('2026-01-23')
    expect(unit.marketingTexts).toEqual(['PLUS TWO MONTHS FREE'])
    expect(unit.detailUrl).toBe('https://apertureorlando.com/floorplan/2br-2ba-b1/')
  })

  it('a sold-out floorplan with an empty first_available_date array maps to a null availableOn', () => {
    const unit = units.find((u) => u.externalId === '2684')!
    expect(unit.floorplanName).toBe('Studio – S1')
    expect(unit.beds).toBe(0)
    expect(unit.availableOn).toBeNull() // first_available_date is [] (not a string) when sold out
    expect(unit.marketingTexts).toEqual([]) // current_special_text is "" when sold out
  })

  it('throws a named error when a required field is missing', () => {
    expect(() => parseEntrataPayload([{ post_id: 1, title: 'No beds here' }])).toThrow(EntrataPayloadError)
  })
})

describe('parseEntrataPayload (golden, rentpress shape — Knightsbridge capture)', () => {
  // Same convention as the v1/v2 embedded blocks above: re-derive the
  // payload from the raw HTML the way entrataAdapter.fetch's
  // extractEmbeddedJson does internally, so this exercises the real
  // entity-encoded attribute + decode on a genuine pre-existing capture
  // (see fixtures/README.md for provenance), not a pre-cleaned fixture.
  const RENTPRESS_EMBEDDED_ATTR_RE = /data-floorplans='([^']*)'/
  function decodeHtmlEntities(s: string): string {
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
  const rentpressPayload = JSON.parse(decodeHtmlEntities(rentpressHtml.match(RENTPRESS_EMBEDDED_ATTR_RE)![1]!))
  const KNIGHTSBRIDGE_ENDPOINT = 'https://www.liveatknightsbridge.com/floor-plans/'
  const units = parseEntrataPayload(rentpressPayload, KNIGHTSBRIDGE_ENDPOINT)

  it('flattens the nested per-floorplan units[] into 37 individual units with sane fields, distinct external ids', () => {
    // 16 top-level floorplan records in the fixture, of which some (sold
    // out / no physical units currently modeled) contribute an empty
    // `units` array — 37 is the total across all of them, i.e. the
    // observed UNIT count, not the floorplan count.
    expect(units.length).toBe(37)
    for (const u of units) {
      expect(u.externalId).toBeTruthy()
      expect(u.beds).toBeGreaterThanOrEqual(0)
      expect(u.baths).toBeGreaterThanOrEqual(1)
      expect(u.rentCents === null || u.rentCents > 30000).toBe(true)
      expect(u.unitNumber).toBeTruthy() // genuine per-physical-unit granularity, unlike v2/v3
    }
    expect(new Set(units.map((u) => u.externalId)).size).toBe(units.length)
  })

  it('maps a known unit (unit_code 5676992_10, floorplan "A1 Renovated") faithfully', () => {
    const unit = units.find((u) => u.externalId === '5676992_10')!
    expect(unit.floorplanName).toBe('A1 Renovated')
    expect(unit.unitNumber).toBe('103')
    expect(unit.beds).toBe(1)
    expect(unit.baths).toBe(1)
    expect(unit.sqft).toBe(531)
    expect(unit.rentCents).toBe(149300) // $1493 -> cents (unit_rent_effective)
    expect(unit.rentSpecialCents).toBeNull() // no distinct discounted-rate field at unit level on this fixture
    // Normalization shim: the source's "M/D/YYYY" ("8/6/2026") must become
    // ISO "YYYY-MM-DD" — z.string().date() (schema) and extract.ts's
    // string comparison against nowIso both require ISO, unlike v1/v2/v3
    // which already receive ISO-ish dates from their sources.
    expect(unit.availableOn).toBe('2026-08-06')
    expect(unit.detailUrl).toBe('https://www.liveatknightsbridge.com/floorplans/a1-2/')
  })

  it('a floorplan with an empty units[] (no individual units currently modeled) contributes zero units, not a placeholder', () => {
    const ids = units.map((u) => u.externalId)
    // 5676992_A1C ("A1C") is the fixture's first floorplan record and has
    // floorplan_available: "0" / units: [] — it must not appear at all.
    expect(ids.some((id) => id.startsWith('969'))).toBe(false)
  })

  it('throws a named error when a required field is missing', () => {
    expect(() =>
      parseEntrataPayload([{ floorplan_code: 'x', units: [{ unit_name: 'No unit_code here', unit_bedrooms: '1', unit_bathrooms: '1' }] }]),
    ).toThrow(EntrataPayloadError)
  })

  it('throws a named error when the floorplan record has no units array', () => {
    expect(() => parseEntrataPayload([{ floorplan_code: 'x' }])).toThrow(EntrataPayloadError)
  })

  it('a malformed, missing, or garbage unit_available_on degrades to a null availableOn — never throws, the unit still extracts', () => {
    const base = { floorplan_code: 'x', floorplan_post_title: 'X1' }
    const makeUnit = (extra: Record<string, unknown>) => ({
      unit_code: 'u1',
      unit_name: '1',
      unit_bedrooms: '1',
      unit_bathrooms: '1',
      ...extra,
    })
    // empty string
    expect(() => parseEntrataPayload([{ ...base, units: [makeUnit({ unit_available_on: '' })] }])).not.toThrow()
    expect(parseEntrataPayload([{ ...base, units: [makeUnit({ unit_available_on: '' })] }])[0]!.availableOn).toBeNull()
    // key entirely absent
    expect(() => parseEntrataPayload([{ ...base, units: [makeUnit({})] }])).not.toThrow()
    expect(parseEntrataPayload([{ ...base, units: [makeUnit({})] }])[0]!.availableOn).toBeNull()
    // garbage (not date-shaped at all)
    expect(() => parseEntrataPayload([{ ...base, units: [makeUnit({ unit_available_on: 'not-a-date' })] }])).not.toThrow()
    const garbageUnits = parseEntrataPayload([{ ...base, units: [makeUnit({ unit_available_on: 'not-a-date' })] }])
    expect(garbageUnits.length).toBe(1) // the unit still extracts, just with a null date
    expect(garbageUnits[0]!.availableOn).toBeNull()
    expect(garbageUnits[0]!.externalId).toBe('u1')
  })
})

describe('entrataAdapter', () => {
  it('fetches text through the injected fetcher; JSON body parses directly (REST shape), verbatim + hashed', async () => {
    const fetcher: PoliteFetcher = {
      fetchJson: async () => {
        throw new Error('fetchJson should not be called by entrataAdapter')
      },
      fetchText: async (url, policy) => {
        expect(url).toBe('https://example.com/feed.json')
        expect(policy).toBeNull()
        return { status: 200, body: JSON.stringify(restPayload) }
      },
    }
    const snap = await entrataAdapter.fetch(SOURCE, fetcher)
    expect(snap.source_id).toBe(7)
    expect(snap.payload).toEqual(restPayload)
    expect(snap.content_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('extracts the embedded JSON when the body is HTML, not directly JSON', async () => {
    const fetcher: PoliteFetcher = {
      fetchJson: async () => {
        throw new Error('fetchJson should not be called by entrataAdapter')
      },
      fetchText: async () => ({ status: 200, body: embeddedHtml }),
    }
    const snap = await entrataAdapter.fetch(SOURCE, fetcher)
    const units = parseEntrataPayload(snap.payload)
    expect(units.length).toBe(137)
    expect(snap.content_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('extracts the v2 embedded JSON when the body has the :floor_plans attribute, not the v1 script tag', async () => {
    const fetcher: PoliteFetcher = {
      fetchJson: async () => {
        throw new Error('fetchJson should not be called by entrataAdapter')
      },
      fetchText: async () => ({ status: 200, body: embeddedV2Html }),
    }
    const snap = await entrataAdapter.fetch(SOURCE, fetcher)
    const units = parseEntrataPayload(snap.payload)
    expect(units.length).toBe(11)
    expect(snap.content_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('extracts the rentpress embedded JSON when the body has the data-floorplans attribute, not the v1 script tag or v2 :floor_plans attribute', async () => {
    const fetcher: PoliteFetcher = {
      fetchJson: async () => {
        throw new Error('fetchJson should not be called by entrataAdapter')
      },
      fetchText: async () => ({ status: 200, body: rentpressHtml }),
    }
    const snap = await entrataAdapter.fetch(SOURCE, fetcher)
    const units = parseEntrataPayload(snap.payload)
    expect(units.length).toBe(37)
    expect(snap.content_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('throws a named error listing all three embedded patterns when none is found in HTML', async () => {
    const fetcher: PoliteFetcher = {
      fetchJson: async () => {
        throw new Error('unused')
      },
      fetchText: async () => ({ status: 200, body: '<html><body>no floorplan data here</body></html>' }),
    }
    await expect(entrataAdapter.fetch(SOURCE, fetcher)).rejects.toThrow(/jd-fp-data-script-app/)
    await expect(entrataAdapter.fetch(SOURCE, fetcher)).rejects.toThrow(/floor_plans/)
    await expect(entrataAdapter.fetch(SOURCE, fetcher)).rejects.toThrow(/data-floorplans/)
  })

  it('throws on a non-200 response', async () => {
    const fetcher: PoliteFetcher = {
      fetchJson: async () => {
        throw new Error('unused')
      },
      fetchText: async () => ({ status: 404, body: 'not found' }),
    }
    await expect(entrataAdapter.fetch(SOURCE, fetcher)).rejects.toThrow()
  })

  it("passes the source's rate_limit_rps as the per-call maxRps, coerced from pg's numeric-as-string", async () => {
    let seenMaxRps: number | undefined
    const fetcher: PoliteFetcher = {
      fetchJson: async () => {
        throw new Error('unused')
      },
      fetchText: async (url, policy, opts) => {
        seenMaxRps = opts?.maxRps
        return { status: 200, body: JSON.stringify(restPayload) }
      },
    }
    // pg returns `numeric` columns as strings — the source row here mirrors that.
    await entrataAdapter.fetch({ ...SOURCE, rate_limit_rps: '0.5' as unknown as number }, fetcher)
    expect(seenMaxRps).toBe(0.5)
  })

  it('a non-positive rate_limit_rps (0, negative, or garbage) falls back to the fetcher default spacing (M8a)', async () => {
    let seenMaxRps: number | undefined = -999
    const fetcher: PoliteFetcher = {
      fetchJson: async () => {
        throw new Error('unused')
      },
      fetchText: async (url, policy, opts) => {
        seenMaxRps = opts?.maxRps
        return { status: 200, body: JSON.stringify(restPayload) }
      },
    }
    await entrataAdapter.fetch({ ...SOURCE, rate_limit_rps: '-1' as unknown as number }, fetcher)
    expect(seenMaxRps).toBeUndefined()
  })
})
