import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '@aptv2/db/test-helpers'
import { RobotsDisallowedError, type PoliteFetcher } from '@aptv2/scrapers'
import { verifyCandidate } from '../src/verify'

let pool: Pool
beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await resetTestDb(pool)
})
afterAll(async () => {
  await pool.end()
})
beforeEach(async () => {
  await pool.query('DELETE FROM sources')
})

// A fake PoliteFetcher keyed by exact URL. 'robots-disallow' simulates the
// real fetcher's behavior of throwing before any network call happens.
type Canned = { status: number; body?: unknown; text?: string } | 'robots-disallow'

function fakeFetcher(responses: Record<string, Canned>): PoliteFetcher {
  const lookup = (url: string): Canned => {
    const hit = responses[url]
    if (!hit) throw new Error(`unexpected fetch: ${url}`)
    return hit
  }
  return {
    async fetchText(url) {
      const r = lookup(url)
      if (r === 'robots-disallow') throw new RobotsDisallowedError(url)
      return { status: r.status, body: r.text ?? '' }
    },
    async fetchJson(url) {
      const r = lookup(url)
      if (r === 'robots-disallow') throw new RobotsDisallowedError(url)
      return { status: r.status, body: r.body }
    },
  }
}

const PERMISSIVE_ROBOTS = { status: 200, text: 'User-agent: *\nDisallow:\n' }
const DISALLOW_ALL_ROBOTS = { status: 200, text: 'User-agent: *\nDisallow: /\n' }
const NO_ROBOTS_FILE = { status: 404, text: '' }

const PLAIN_HOMEPAGE = { status: 200, text: '<html><body><h1>Not Entrata</h1></body></html>' }

const ORLANDO_LD_JSON = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"ApartmentComplex","name":"Test Community","address":{"@type":"PostalAddress","streetAddress":"1 Test Blvd","addressLocality":"Orlando","addressRegion":"FL","postalCode":"32801"},"geo":{"@type":"GeoCoordinates","latitude":"28.5","longitude":"-81.4"}}</script>`

const ATLANTA_LD_JSON = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"ApartmentComplex","name":"Out Of Scope Community","address":{"@type":"PostalAddress","streetAddress":"1 Peachtree St","addressLocality":"Atlanta","addressRegion":"GA","postalCode":"30309"},"geo":{"@type":"GeoCoordinates","latitude":"33.8","longitude":"-84.4"}}</script>`

const REST_HOMEPAGE_HTML = {
  status: 200,
  text: `<html><head><script id="x-js-extra">var s={"endpoint":"\\/wp-json\\/entrata\\/v3\\/termrent-floor-plans"};</script></head><body>${ORLANDO_LD_JSON}</body></html>`,
}

const VALID_REST_PAYLOAD = [
  { name: 'Annual', bedrooms: [[{ ID: 1, unit_bedrooms: 1, unit_bathrooms: 1, term_rent: [{ rent: 1500 }] }]] },
]

function embeddedV1Html(ldJson: string, unitsJson: string) {
  return `<html><head></head><body>${ldJson}<script type="application/json" id="jd-fp-data-script-app">${unitsJson}</script></body></html>`
}

describe('verifyCandidate', () => {
  it('robots disallowing the homepage → not_public, with exactly the mandated phrase and nothing more', async () => {
    const fetcher = fakeFetcher({
      'https://example.com/robots.txt': DISALLOW_ALL_ROBOTS,
    })
    const result = await verifyCandidate({ url: 'https://example.com/', metro: 'Orlando' }, fetcher, { pool })
    expect(result).toEqual({ url: 'https://example.com/', verdict: 'not_public', detail: 'not publicly accessible' })
  })

  it('homepage 403 → not_public', async () => {
    const fetcher = fakeFetcher({
      'https://example.com/robots.txt': NO_ROBOTS_FILE,
      'https://example.com/': { status: 403, text: '' },
    })
    const result = await verifyCandidate({ url: 'https://example.com/', metro: 'Orlando' }, fetcher, { pool })
    expect(result.verdict).toBe('not_public')
    expect(result.detail).toBe('not publicly accessible')
  })

  it('homepage 500 → not_entrata', async () => {
    const fetcher = fakeFetcher({
      'https://example.com/robots.txt': NO_ROBOTS_FILE,
      'https://example.com/': { status: 500, text: '' },
    })
    const result = await verifyCandidate({ url: 'https://example.com/', metro: 'Orlando' }, fetcher, { pool })
    expect(result.verdict).toBe('not_entrata')
  })

  it('no Entrata fingerprint on homepage or /floor-plans/ → not_entrata', async () => {
    const fetcher = fakeFetcher({
      'https://example.com/robots.txt': NO_ROBOTS_FILE,
      'https://example.com/': PLAIN_HOMEPAGE,
      'https://example.com/floor-plans/': PLAIN_HOMEPAGE,
    })
    const result = await verifyCandidate({ url: 'https://example.com/', metro: 'Orlando' }, fetcher, { pool })
    expect(result.verdict).toBe('not_entrata')
  })

  it('REST fingerprint found but the endpoint probe 404s → no_endpoint', async () => {
    const fetcher = fakeFetcher({
      'https://example.com/robots.txt': NO_ROBOTS_FILE,
      'https://example.com/': REST_HOMEPAGE_HTML,
      'https://example.com/wp-json/entrata/v3/termrent-floor-plans': { status: 404, body: null },
    })
    const result = await verifyCandidate({ url: 'https://example.com/', metro: 'Orlando' }, fetcher, { pool })
    expect(result.verdict).toBe('no_endpoint')
  })

  it('REST fingerprint found but the endpoint returns an unparseable payload → no_endpoint', async () => {
    const fetcher = fakeFetcher({
      'https://example.com/robots.txt': NO_ROBOTS_FILE,
      'https://example.com/': REST_HOMEPAGE_HTML,
      'https://example.com/wp-json/entrata/v3/termrent-floor-plans': { status: 200, body: { garbage: true } },
    })
    const result = await verifyCandidate({ url: 'https://example.com/', metro: 'Orlando' }, fetcher, { pool })
    expect(result.verdict).toBe('no_endpoint')
  })

  it('embedded-v1 fingerprint found but the embedded JSON has no units array → no_endpoint', async () => {
    const html = embeddedV1Html(ORLANDO_LD_JSON, '{"nope":true}')
    const fetcher = fakeFetcher({
      'https://example.com/robots.txt': NO_ROBOTS_FILE,
      'https://example.com/': { status: 200, text: html },
    })
    const result = await verifyCandidate({ url: 'https://example.com/', metro: 'Orlando' }, fetcher, { pool })
    expect(result.verdict).toBe('no_endpoint')
  })

  it('fingerprint + endpoint valid, but no facts found anywhere → no_facts', async () => {
    const html = embeddedV1Html('', '{"units":[{"id_value":1,"bedrooms":"1","bathrooms":"1"}]}')
    const fetcher = fakeFetcher({
      'https://example.com/robots.txt': NO_ROBOTS_FILE,
      'https://example.com/': { status: 200, text: html },
      'https://example.com/contact/': { status: 200, text: '<html><body>no address here</body></html>' },
    })
    const result = await verifyCandidate({ url: 'https://example.com/', metro: 'Orlando' }, fetcher, { pool })
    expect(result.verdict).toBe('no_facts')
  })

  it('facts found but city is not in FLORIDA_CITIES → out_of_scope', async () => {
    const html = embeddedV1Html(ATLANTA_LD_JSON, '{"units":[{"id_value":1,"bedrooms":"1","bathrooms":"1"}]}')
    const fetcher = fakeFetcher({
      'https://example.com/robots.txt': NO_ROBOTS_FILE,
      'https://example.com/': { status: 200, text: html },
    })
    const result = await verifyCandidate({ url: 'https://example.com/', metro: 'Orlando' }, fetcher, { pool })
    expect(result.verdict).toBe('out_of_scope')
  })

  it('full happy path (REST mode) → registered, upserts the sources row with mode + facts', async () => {
    const fetcher = fakeFetcher({
      'https://example.com/robots.txt': PERMISSIVE_ROBOTS,
      'https://example.com/': REST_HOMEPAGE_HTML,
      'https://example.com/wp-json/entrata/v3/termrent-floor-plans': { status: 200, body: VALID_REST_PAYLOAD },
    })
    const result = await verifyCandidate({ url: 'https://example.com/', metro: 'Orlando' }, fetcher, { pool })
    expect(result.verdict).toBe('registered')

    const { rows } = await pool.query(`SELECT * FROM sources WHERE website_url = $1`, ['https://example.com/'])
    expect(rows).toHaveLength(1)
    expect(rows[0].platform).toBe('entrata')
    expect(rows[0].enabled).toBe(true)
    expect(rows[0].endpoint_config.mode).toBe('rest')
    expect(rows[0].endpoint_config.endpoint_url).toBe('https://example.com/wp-json/entrata/v3/termrent-floor-plans')
    expect(rows[0].endpoint_config.property.city).toBe('Orlando')
    expect(rows[0].robots_policy).not.toBeNull()
  })

  it('full happy path (embedded-v1 mode, no separate endpoint request) → registered', async () => {
    const html = embeddedV1Html(ORLANDO_LD_JSON, '{"units":[{"id_value":1,"bedrooms":"1","bathrooms":"1"}]}')
    const fetcher = fakeFetcher({
      'https://embedded-example.com/robots.txt': PERMISSIVE_ROBOTS,
      'https://embedded-example.com/': { status: 200, text: html },
    })
    const result = await verifyCandidate({ url: 'https://embedded-example.com/', metro: 'Orlando' }, fetcher, { pool })
    expect(result.verdict).toBe('registered')

    const { rows } = await pool.query(`SELECT * FROM sources WHERE website_url = $1`, ['https://embedded-example.com/'])
    expect(rows[0].endpoint_config.mode).toBe('embedded-v1')
    expect(rows[0].endpoint_config.endpoint_url).toBe('https://embedded-example.com/')
  })

  it('is idempotent by website_url: re-verifying an already-registered candidate does not insert a duplicate row', async () => {
    const html = embeddedV1Html(ORLANDO_LD_JSON, '{"units":[{"id_value":1,"bedrooms":"1","bathrooms":"1"}]}')
    const fetcher = fakeFetcher({
      'https://idempotent-example.com/robots.txt': PERMISSIVE_ROBOTS,
      'https://idempotent-example.com/': { status: 200, text: html },
    })
    const candidate = { url: 'https://idempotent-example.com/', metro: 'Orlando' }
    const first = await verifyCandidate(candidate, fetcher, { pool })
    const second = await verifyCandidate(candidate, fetcher, { pool })
    expect(first.verdict).toBe('registered')
    expect(second.verdict).toBe('registered')
    const { rows } = await pool.query(`SELECT * FROM sources WHERE website_url = $1`, [candidate.url])
    expect(rows).toHaveLength(1)
  })

  it('geocodes via the injected geocode dep when LD+JSON has no geo, and records it in detail', async () => {
    const noGeoLdJson = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"ApartmentComplex","name":"No Geo Community","address":{"@type":"PostalAddress","streetAddress":"1 Test Blvd","addressLocality":"Tampa","addressRegion":"FL","postalCode":"33602"}}</script>`
    const html = embeddedV1Html(noGeoLdJson, '{"units":[{"id_value":1,"bedrooms":"1","bathrooms":"1"}]}')
    const fetcher = fakeFetcher({
      'https://geocoded-example.com/robots.txt': PERMISSIVE_ROBOTS,
      'https://geocoded-example.com/': { status: 200, text: html },
    })
    const geocode = async () => ({ latitude: 27.95, longitude: -82.46 })
    const result = await verifyCandidate({ url: 'https://geocoded-example.com/', metro: 'Tampa' }, fetcher, {
      pool,
      geocode,
    })
    expect(result.verdict).toBe('registered')
    expect(result.detail).toContain('geocoded=true')
  })
})
