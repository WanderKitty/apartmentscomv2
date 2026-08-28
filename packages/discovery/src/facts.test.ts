import { describe, it, expect, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { extractPropertyFacts } from './facts'

// Small crafted LD+JSON snippets modeled on the real shapes observed in
// packages/scrapers/fixtures/entrata-embedded.html (Society Orlando — a
// @graph array with ApartmentComplex/PostalAddress/GeoCoordinates) and
// entrata-embedded-v2.html (Aperture — a flat ApartmentComplex object with
// a PostalAddress but NO geo, exercising the "coordinates missing" path).
// Trimmed to just the fields extractPropertyFacts needs; not full captures.

const GRAPH_LD_JSON_HTML = `<!doctype html><html><head>
<script type="application/ld+json">{"@context":{"@vocab":"https://schema.org/"},"@graph":[{"@type":["ApartmentComplex","LocalBusiness"],"name":"Society Orlando","address":{"@type":"PostalAddress","streetAddress":"410 N Orange Ave","addressLocality":"Orlando","addressRegion":"FL","postalCode":"32801","addressCountry":"US"},"geo":{"@type":"GeoCoordinates","latitude":"28.54810825133527","longitude":"-81.37941716158352"}}]}</script>
</head><body><h1>Society Orlando</h1></body></html>`

const FLAT_LD_JSON_NO_GEO_HTML = `<!doctype html><html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"ApartmentComplex","name":"Aperture","address":{"@type":"PostalAddress","addressCountry":"US","addressLocality":"Orlando","addressRegion":"FL","postalCode":"32826","streetAddress":"12727 E Colonial Dr"}}</script>
</head><body><h1>Aperture</h1></body></html>`

// A legitimate FL-state entity whose city (Naples) is not in FLORIDA_CITIES:
// facts.ts has no knowledge of that enum (scope-gating is verifyCandidate's
// job), so this must pass the sanity gate (FL state, name matches title)
// and come back unchanged — only the caller decides it's out of scope.
const NAPLES_LD_JSON_HTML = `<!doctype html><html><head><title>Bayview Naples Apartments</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"ApartmentComplex","name":"Bayview Naples","address":{"@type":"PostalAddress","addressCountry":"US","addressLocality":"Naples","addressRegion":"FL","postalCode":"34102","streetAddress":"100 Bay St"}}</script>
</head><body><h1>Welcome</h1></body></html>`

// Review finding I6: an entity that reads like a plausible Miami-area
// listing (title matches the LD+JSON name exactly) but carries a wrong
// state — the sanity gate must reject it on the state check alone.
const WRONG_STATE_LD_JSON_HTML = `<!doctype html><html><head><title>Bayview Miami Apartments</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"ApartmentComplex","name":"Bayview Miami","address":{"@type":"PostalAddress","addressCountry":"US","addressLocality":"Miami","addressRegion":"NY","postalCode":"10001","streetAddress":"100 Bay St"}}</script>
</head><body><h1>Welcome</h1></body></html>`

const NO_LD_JSON_HTML = `<!doctype html><html><body><h1>Call us at 555-1234</h1><p>123 Main St, Tampa, FL 33602</p></body></html>`

describe('extractPropertyFacts (deterministic path)', () => {
  it('extracts name/address/geo from a @graph LD+JSON PostalAddress + GeoCoordinates', async () => {
    const facts = await extractPropertyFacts(GRAPH_LD_JSON_HTML, 'https://societyorlando.com/floorplans/', {})
    expect(facts).toEqual({
      name: 'Society Orlando',
      address_line1: '410 N Orange Ave',
      city: 'Orlando',
      state: 'FL',
      zip: '32801',
      latitude: 28.54810825133527,
      longitude: -81.37941716158352,
    })
  })

  it('falls back to geocode when LD+JSON has address but no geo', async () => {
    const geocode = vi.fn(async () => ({ latitude: 28.565, longitude: -81.189 }))
    const facts = await extractPropertyFacts(FLAT_LD_JSON_NO_GEO_HTML, 'https://apertureorlando.com/floor-plans/', {
      geocode,
    })
    expect(facts).toEqual({
      name: 'Aperture',
      address_line1: '12727 E Colonial Dr',
      city: 'Orlando',
      state: 'FL',
      zip: '32826',
      latitude: 28.565,
      longitude: -81.189,
    })
    expect(geocode).toHaveBeenCalledWith('12727 E Colonial Dr, Orlando, FL 32826')
  })

  it('returns an FL-state entity whose city is outside FLORIDA_CITIES unchanged (scope check is the caller\'s job)', async () => {
    const facts = await extractPropertyFacts(NAPLES_LD_JSON_HTML, 'https://example.com/', {
      geocode: async () => ({ latitude: 26.14, longitude: -81.79 }),
    })
    expect(facts?.city).toBe('Naples')
  })

  it('review I6: rejects deterministic facts whose declared state is not FL, even when the name matches the page title (falls through to no facts without an llm dep)', async () => {
    const facts = await extractPropertyFacts(WRONG_STATE_LD_JSON_HTML, 'https://example.com/', {
      geocode: async () => ({ latitude: 40.7, longitude: -74.0 }),
    })
    expect(facts).toBeNull()
  })

  it('review I6: the real Aperture fixture\'s stale/wrong LD+JSON (Atlanta template leftover) does NOT register via the deterministic path', async () => {
    const fixturePath = fileURLToPath(new URL('../../scrapers/fixtures/entrata-embedded-v2.html', import.meta.url))
    const html = await readFile(fixturePath, 'utf8')
    // No llm dep: if the sanity gate let the stale LD+JSON through, this
    // would resolve to the wrong data (name "Kinetic", city "Atlanta").
    const facts = await extractPropertyFacts(html, 'https://apertureorlando.com/floor-plans/', {
      geocode: async () => ({ latitude: 33.8, longitude: -84.4 }),
    })
    expect(facts).toBeNull()
  })

  it('returns null with no LD+JSON and no llm dep', async () => {
    const facts = await extractPropertyFacts(NO_LD_JSON_HTML, 'https://example.com/', {})
    expect(facts).toBeNull()
  })

  it('falls back to the Haiku dep when no LD+JSON facts are found (fail-open on llm error)', async () => {
    const llm = vi.fn(async () => ({
      name: 'Example Apartments',
      address_line1: '123 Main St',
      city: 'Tampa',
      state: 'FL',
      zip: '33602',
    }))
    const geocode = vi.fn(async () => ({ latitude: 27.95, longitude: -82.46 }))
    const facts = await extractPropertyFacts(NO_LD_JSON_HTML, 'https://example.com/', { llm, geocode })
    expect(facts).toEqual({
      name: 'Example Apartments',
      address_line1: '123 Main St',
      city: 'Tampa',
      state: 'FL',
      zip: '33602',
      latitude: 27.95,
      longitude: -82.46,
    })
  })

  it('fails open (returns null, does not throw) when the llm dep rejects', async () => {
    const llm = vi.fn(async () => {
      throw new Error('boom')
    })
    const facts = await extractPropertyFacts(NO_LD_JSON_HTML, 'https://example.com/', { llm })
    expect(facts).toBeNull()
  })
})
