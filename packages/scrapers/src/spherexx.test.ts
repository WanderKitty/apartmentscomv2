import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EntrataPayloadError } from './entrata'
import {
  extractSpherexxCards,
  extractSpherexxDetails,
  parseSpherexxPayload,
  spherexxAdapter,
  type SpherexxCard,
  type SpherexxCommunity,
} from './spherexx'
import type { SourceRow } from './types'
import type { PoliteFetcher } from './politeness'

// Captured once (2026-08-28) from live55westorlando.com/floorplans/ — a
// ZRS-managed Spherexx site — with the identified research UA (single
// request). Test fixture only; tests never touch the network.
const html = readFileSync(
  fileURLToPath(new URL('../fixtures/spherexx-floorplans.html', import.meta.url)),
  'utf8',
)
const detailHtml = readFileSync(
  fileURLToPath(new URL('../fixtures/spherexx-detail.html', import.meta.url)),
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

describe("spherexxAdapter", () => {
  it("walks detail pages: merges plan prose + community facts into the payload", async () => {
    const fetcher: PoliteFetcher = {
      fetchText: async (url: string) => {
        if (url === SOURCE.endpoint_config.endpoint_url) return { status: 200, body: html }
        if (url.endsWith("/floorplans/2bedroom/the-flagler-north/")) return { status: 200, body: detailHtml }
        return { status: 200, body: "<html><body>no structured data</body></html>" }
      },
      fetchJson: async () => {
        throw new Error("spherexx adapter must use fetchText, never fetchJson")
      },
    }
    const snap = await spherexxAdapter.fetch(SOURCE, fetcher)
    expect(snap.content_hash).toMatch(/^[0-9a-f]{64}$/)
    const payload = snap.payload as { cards: SpherexxCard[]; community: SpherexxCommunity }
    expect(payload.cards).toHaveLength(4)
    const flagler = payload.cards.find((c) => c.name === "The Flagler North")!
    expect(flagler.description).toContain("expansive two bedroom")
    expect(payload.community.petsAllowed).toBe(true)
    expect(payload.community.amenities).toContain("Rooftop Sundeck")

    const units = parseSpherexxPayload(snap.payload, SOURCE.endpoint_config.endpoint_url)
    const u = units.find((x) => x.externalId === "20547")!
    expect(u.marketingTexts.some((s) => s.includes("expansive two bedroom"))).toBe(true)
    expect(u.marketingTexts).toContain("Pets allowed")
    expect(u.amenityTexts).toContain("Rooftop Sundeck")
  })
})

describe("extractSpherexxDetails (golden, from the captured detail fixture)", () => {
  it("pulls the Floorplan description and the ApartmentComplex facts", () => {
    const { planDescriptions, community } = extractSpherexxDetails(detailHtml)
    expect(planDescriptions.get("The Flagler North")).toContain("expansive two bedroom")
    expect(community.petsAllowed).toBe(true)
    expect(community.amenities.length).toBeGreaterThan(3)
    expect(community.description).toContain("55 West")
  })
})
