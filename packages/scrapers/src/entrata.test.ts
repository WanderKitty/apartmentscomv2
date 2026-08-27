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
  const units = parseEntrataPayload(restPayload)

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
    expect(studio.externalId).toBe('2127')
    expect(studio.floorplanName).toBe('The Studio')
    expect(studio.beds).toBe(0)
    expect(studio.baths).toBe(1)
    expect(studio.sqft).toBe(433)
    expect(studio.rentCents).toBe(175000) // $1750 -> cents
    expect(studio.availableOn).toBeNull() // no availability field on this endpoint
    expect(studio.marketingTexts).toEqual([]) // banner/disclaimer/description all "" for this floorplan
  })

  it('carries free-text marketing strings when the payload has them (floorplan ID 2133, "The Two")', () => {
    const theTwo = units[8]!
    expect(theTwo.externalId).toBe('2133')
    expect(theTwo.marketingTexts).toContain('Limited Availability')
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
  const units = parseEntrataPayload(embeddedPayload)

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

  it('maps a known unit (apartment #1822-B) faithfully', () => {
    const unit = units.find((u) => u.unitNumber === '1822-B')!
    expect(unit.externalId).toBe('8756877')
    expect(unit.floorplanName).toBe('Rent-By-Bedroom | 3 Bed - D1')
    expect(unit.beds).toBe(3)
    expect(unit.baths).toBe(3)
    expect(unit.sqft).toBe(484)
    expect(unit.rentCents).toBe(130500) // $1305 -> cents
    expect(unit.availableOn).toBe('2024-03-18')
    expect(unit.marketingTexts).toContain(
      'Specials Available, Up to 2 Months Free on Select Homes! Contact Us For More Details.',
    )
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

  it('throws on a non-200 response', async () => {
    const fetcher: PoliteFetcher = {
      fetchJson: async () => {
        throw new Error('unused')
      },
      fetchText: async () => ({ status: 404, body: 'not found' }),
    }
    await expect(entrataAdapter.fetch(SOURCE, fetcher)).rejects.toThrow()
  })
})
