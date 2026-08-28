import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EntrataPayloadError } from './entrata'
import { extractSpherexxCards, parseSpherexxPayload, spherexxAdapter } from './spherexx'
import type { SourceRow } from './types'
import type { PoliteFetcher } from './politeness'

// Captured once (2026-08-28) from live55westorlando.com/floorplans/ — a
// ZRS-managed Spherexx site — with the identified research UA (single
// request). Test fixture only; tests never touch the network.
const html = readFileSync(
  fileURLToPath(new URL('../fixtures/spherexx-floorplans.html', import.meta.url)),
  'utf8',
)

const SOURCE: SourceRow = {
  id: 9,
  platform: 'spherexx',
  name: 'Fixture Community',
  website_url: 'https://www.live55westorlando.com/',
  endpoint_config: {
    endpoint_url: 'https://www.live55westorlando.com/floorplans/',
    mode: 'spherexx',
    property: {
      name: 'Live 55 West', address_line1: '55 W Church St', city: 'Orlando',
      state: 'FL', zip: '32801', latitude: 28.545, longitude: -81.379,
    },
  },
  robots_policy: null,
  rate_limit_rps: 1,
}

describe('extractSpherexxCards (golden, from the captured fixture)', () => {
  const cards = extractSpherexxCards(html)

  it('extracts the four available cards with their data attributes', () => {
    expect(cards.map((c) => c.name)).toEqual([
      'The Flagler North', 'The Delaney North', 'The Phillips', 'The Delaney South',
    ])
    const flagler = cards[0]!
    expect(flagler.fp).toBe('20547')
    expect(flagler.minPriceDollars).toBe(2286)
    expect(flagler.maxPriceDollars).toBe(2573)
    expect(flagler.basePriceDollars).toBe(2226)
    expect(flagler.feeTotalDollars).toBe(37.5)
    expect(flagler.sqft).toBe(1402)
    expect(flagler.beds).toBe(2)
    expect(flagler.baths).toBe(2)
    expect(flagler.unitsAvailable).toBe(2)
  })

  it('throws the shared shape error on a wrong-shaped page', () => {
    expect(() => extractSpherexxCards('<html><body>nothing here</body></html>')).toThrow(EntrataPayloadError)
  })
})

describe('parseSpherexxPayload', () => {
  it('maps cards to scraper units, absolutizing detail paths, carrying the fee split', () => {
    const units = parseSpherexxPayload(extractSpherexxCards(html), SOURCE.endpoint_config.endpoint_url)
    expect(units).toHaveLength(4)
    const u = units[0]!
    expect(u.externalId).toBe('20547')
    expect(u.rentCents).toBe(228600)
    expect(u.unitNumber).toBeNull() // floorplan granularity → "starting at"
    expect(u.detailUrl).toBe('https://www.live55westorlando.com/floorplans/2bedroom/the-flagler-north/')
    expect(u.marketingTexts.some((t) => t.includes('mandatory fees'))).toBe(true)
    expect(() => parseSpherexxPayload('nonsense')).toThrow(/spherexx/)
  })
})

describe('spherexxAdapter', () => {
  it('fetches the page once and hashes the EXTRACTED cards (not the raw HTML)', async () => {
    const fetcher: PoliteFetcher = {
      fetchText: async (url: string) => {
        expect(url).toBe(SOURCE.endpoint_config.endpoint_url)
        return { status: 200, body: html }
      },
      fetchJson: async () => {
        throw new Error('spherexx adapter must use fetchText, never fetchJson')
      },
    }
    const snap = await spherexxAdapter.fetch(SOURCE, fetcher)
    expect(snap.source_id).toBe(9)
    expect(snap.content_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(Array.isArray(snap.payload)).toBe(true)
    expect((snap.payload as unknown[]).length).toBe(4)
  })
})
