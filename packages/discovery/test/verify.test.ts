import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '@aptv2/db/test-helpers'
import { RobotsDisallowedError, type PoliteFetcher } from '@aptv2/scrapers'
import { verifyCandidate, type RobotsCache } from '../src/verify'

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
// 'network-error' simulates a pure network failure. A canned status of
// 5xx/429 auto-throws too (review I4/I5) — the real politeness fetcher
// NEVER returns those statuses to a caller: it retries them internally and
// eventually throws (or, with retry429:false, throws immediately on 429).
type Canned = { status: number; body?: unknown; text?: string } | 'robots-disallow' | 'network-error'

function fakeFetcher(responses: Record<string, Canned>): PoliteFetcher {
  const lookup = (url: string): Canned => {
    const hit = responses[url]
    if (!hit) throw new Error(`unexpected fetch: ${url}`)
    return hit
  }
  const settle = (r: Canned, url: string): { status: number; body?: unknown; text?: string } => {
    if (r === 'robots-disallow') throw new RobotsDisallowedError(url)
    if (r === 'network-error') throw new Error('network error')
    if (r.status >= 500 || r.status === 429) throw new Error(`fetch failed after 3 attempts (${r.status}): ${url}`)
    return r
  }
  return {
    async fetchText(url) {
      const r = settle(lookup(url), url)
      return { status: r.status, body: r.text ?? '' }
    },
    async fetchJson(url) {
      const r = settle(lookup(url), url)
      return { status: r.status, body: r.body }
    },
  }
}

/** Wraps a fetcher to count every fetchText/fetchJson call made through it
 * (review I8: budget verification with a counting fetcher). */
function countingFetcher(inner: PoliteFetcher): { fetcher: PoliteFetcher; count: () => number } {
  let n = 0
  return {
    fetcher: {
      fetchText: (...args) => {
        n++
        return inner.fetchText(...args)
      },
      fetchJson: (...args) => {
        n++
        return inner.fetchJson(...args)
      },
    },
    count: () => n,
  }
}

const PERMISSIVE_ROBOTS = { status: 200, text: 'User-agent: *\nDisallow:\n' }
const DISALLOW_ALL_ROBOTS = { status: 200, text: 'User-agent: *\nDisallow: /\n' }
const NO_ROBOTS_FILE = { status: 404, text: '' }

const PLAIN_HOMEPAGE = { status: 200, text: '<html><body><h1>Not Entrata</h1></body></html>' }

const ORLANDO_LD_JSON = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"ApartmentComplex","name":"Test Community","address":{"@type":"PostalAddress","streetAddress":"1 Test Blvd","addressLocality":"Orlando","addressRegion":"FL","postalCode":"32801"},"geo":{"@type":"GeoCoordinates","latitude":"28.5","longitude":"-81.4"}}</script>`

// A legitimate FL-state entity (passes the I6 sanity gate) whose city
// (Naples) simply isn't one of the 10 FLORIDA_CITIES — the review's
// replacement for the old Atlanta/GA example, which now gets rejected
// earlier (by facts.ts's own sanity gate) rather than reaching the scope
// check at all.
const NAPLES_LD_JSON = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"ApartmentComplex","name":"Out Of Scope Community","address":{"@type":"PostalAddress","streetAddress":"1 Bay St","addressLocality":"Naples","addressRegion":"FL","postalCode":"34102"},"geo":{"@type":"GeoCoordinates","latitude":"26.1","longitude":"-81.7"}}</script>`

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

// rentpressFloorplansJson must already be entity-encoded (&quot; for `"`,
// single-quoted attribute) — the real shape, per entrata.ts's rentpress
// section and fixtures/README.md's Knightsbridge provenance.
function embeddedRentpressHtml(ldJson: string, rentpressFloorplansJson: string) {
  return `<html><head></head><body>${ldJson}<div id='rentpress-app' data-floorplans='${rentpressFloorplansJson}'></div></body></html>`
}
const VALID_RENTPRESS_FLOORPLANS = '[{&quot;floorplan_code&quot;:&quot;1_A1&quot;,&quot;floorplan_post_title&quot;:&quot;A1&quot;,&quot;units&quot;:[{&quot;unit_code&quot;:&quot;1_A1_101&quot;,&quot;unit_name&quot;:&quot;101&quot;,&quot;unit_bedrooms&quot;:&quot;1&quot;,&quot;unit_bathrooms&quot;:&quot;1&quot;}]}]'

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

  it('review I4: homepage 5xx (the real fetcher never returns this — it throws) → unreachable, not not_entrata', async () => {
    const fetcher = fakeFetcher({
      'https://example.com/robots.txt': NO_ROBOTS_FILE,
      'https://example.com/': { status: 500, text: '' },
    })
    const result = await verifyCandidate({ url: 'https://example.com/', metro: 'Orlando' }, fetcher, { pool })
    expect(result.verdict).toBe('unreachable')
    expect(result.detail).toBe('unreachable at verification time')
  })

  it('review I4: homepage 429 → unreachable', async () => {
    const fetcher = fakeFetcher({
      'https://example.com/robots.txt': NO_ROBOTS_FILE,
      'https://example.com/': { status: 429, text: '' },
    })
    const result = await verifyCandidate({ url: 'https://example.com/', metro: 'Orlando' }, fetcher, { pool })
    expect(result.verdict).toBe('unreachable')
  })

  it('review I4: a pure network error fetching the homepage → unreachable', async () => {
    const fetcher = fakeFetcher({
      'https://example.com/robots.txt': NO_ROBOTS_FILE,
      'https://example.com/': 'network-error',
    })
    const result = await verifyCandidate({ url: 'https://example.com/', metro: 'Orlando' }, fetcher, { pool })
    expect(result.verdict).toBe('unreachable')
  })

  it('review I5: robots.txt 403 → unreachable after exactly 1 request', async () => {
    const inner = fakeFetcher({ 'https://example.com/robots.txt': { status: 403, text: '' } })
    const { fetcher, count } = countingFetcher(inner)
    const result = await verifyCandidate({ url: 'https://example.com/', metro: 'Orlando' }, fetcher, { pool })
    expect(result.verdict).toBe('unreachable')
    expect(count()).toBe(1)
  })

  it('review I5: robots.txt 5xx → unreachable after exactly 1 request', async () => {
    const inner = fakeFetcher({ 'https://example.com/robots.txt': { status: 503, text: '' } })
    const { fetcher, count } = countingFetcher(inner)
    const result = await verifyCandidate({ url: 'https://example.com/', metro: 'Orlando' }, fetcher, { pool })
    expect(result.verdict).toBe('unreachable')
    expect(count()).toBe(1)
  })

  it('review I5: robots.txt throw (network error) → unreachable', async () => {
    const fetcher = fakeFetcher({ 'https://example.com/robots.txt': 'network-error' })
    const result = await verifyCandidate({ url: 'https://example.com/', metro: 'Orlando' }, fetcher, { pool })
    expect(result.verdict).toBe('unreachable')
  })

  it('no Entrata fingerprint on homepage or /floor-plans/ → not_entrata (also proves robots.txt 404/missing stays permissive: verification reached this far)', async () => {
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
    const html = embeddedV1Html(NAPLES_LD_JSON, '{"units":[{"id_value":1,"bedrooms":"1","bathrooms":"1"}]}')
    const fetcher = fakeFetcher({
      'https://example.com/robots.txt': NO_ROBOTS_FILE,
      'https://example.com/': { status: 200, text: html },
    })
    const result = await verifyCandidate({ url: 'https://example.com/', metro: 'Orlando' }, fetcher, { pool })
    expect(result.verdict).toBe('out_of_scope')
  })

  it('review I7: an out-of-scope candidate burns zero Nominatim (geocode) requests', async () => {
    const html = embeddedV1Html(NAPLES_LD_JSON, '{"units":[{"id_value":1,"bedrooms":"1","bathrooms":"1"}]}')
    const fetcher = fakeFetcher({
      'https://example.com/robots.txt': NO_ROBOTS_FILE,
      'https://example.com/': { status: 200, text: html },
    })
    let geocodeCalls = 0
    const geocode = async () => {
      geocodeCalls++
      return { latitude: 26.1, longitude: -81.7 }
    }
    const result = await verifyCandidate({ url: 'https://example.com/', metro: 'Orlando' }, fetcher, { pool, geocode })
    expect(result.verdict).toBe('out_of_scope')
    expect(geocodeCalls).toBe(0)
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

  it('full happy path (rentpress mode, no separate endpoint request — same pattern as the other embedded modes) → registered', async () => {
    const html = embeddedRentpressHtml(ORLANDO_LD_JSON, VALID_RENTPRESS_FLOORPLANS)
    const fetcher = fakeFetcher({
      'https://rentpress-example.com/robots.txt': PERMISSIVE_ROBOTS,
      'https://rentpress-example.com/': { status: 200, text: html },
    })
    const result = await verifyCandidate({ url: 'https://rentpress-example.com/', metro: 'Orlando' }, fetcher, { pool })
    expect(result.verdict).toBe('registered')

    const { rows } = await pool.query(`SELECT * FROM sources WHERE website_url = $1`, ['https://rentpress-example.com/'])
    expect(rows[0].endpoint_config.mode).toBe('rentpress')
    // The probe IS the floor-plans page itself, like the other embedded
    // modes — no extra endpoint request, unlike REST mode.
    expect(rows[0].endpoint_config.endpoint_url).toBe('https://rentpress-example.com/')
  })

  it('rentpress fingerprint found but the embedded JSON has no units array on a floorplan record → no_endpoint', async () => {
    const html = embeddedRentpressHtml(ORLANDO_LD_JSON, '[{&quot;floorplan_code&quot;:&quot;1_A1&quot;}]')
    const fetcher = fakeFetcher({
      'https://rentpress-noendpoint.example.com/robots.txt': NO_ROBOTS_FILE,
      'https://rentpress-noendpoint.example.com/': { status: 200, text: html },
    })
    const result = await verifyCandidate({ url: 'https://rentpress-noendpoint.example.com/', metro: 'Orlando' }, fetcher, { pool })
    expect(result.verdict).toBe('no_endpoint')
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

  describe('review C1: probe URLs resolve RELATIVE TO THE CANDIDATE, not the host origin', () => {
    it('a root-domain candidate probes "<origin>/floor-plans/" (unchanged behavior)', async () => {
      const html = embeddedV1Html(ORLANDO_LD_JSON, '{"units":[{"id_value":1,"bedrooms":"1","bathrooms":"1"}]}')
      const fetcher = fakeFetcher({
        'https://root-example.com/robots.txt': PERMISSIVE_ROBOTS,
        'https://root-example.com/': PLAIN_HOMEPAGE, // no fingerprint here — forces the floor-plans probe
        'https://root-example.com/floor-plans/': { status: 200, text: html },
      })
      const result = await verifyCandidate({ url: 'https://root-example.com/', metro: 'Orlando' }, fetcher, { pool })
      expect(result.verdict).toBe('registered')
    })

    it('a path-scoped candidate (no trailing slash) probes a SUBDIRECTORY of its own path, not a sibling of the host', async () => {
      const html = embeddedV1Html(ORLANDO_LD_JSON, '{"units":[{"id_value":1,"bedrooms":"1","bathrooms":"1"}]}')
      const fetcher = fakeFetcher({
        'https://mgmt.example.com/robots.txt': PERMISSIVE_ROBOTS,
        'https://mgmt.example.com/properties/slug': PLAIN_HOMEPAGE, // candidate URL as given, no trailing slash
        // Correct resolution: a subdirectory of the candidate's OWN page.
        'https://mgmt.example.com/properties/slug/floor-plans/': { status: 200, text: html },
        // If verify.ts regressed to origin-based resolution, it would hit
        // this WRONG sibling URL instead — deliberately NOT registered
        // here, so that mistake would throw "unexpected fetch" and fail
        // the test loudly rather than silently passing.
      })
      const result = await verifyCandidate(
        { url: 'https://mgmt.example.com/properties/slug', metro: 'Orlando' },
        fetcher,
        { pool },
      )
      expect(result.verdict).toBe('registered')
    })
  })

  describe('review C1: per-host robots.txt memoization', () => {
    it('two candidates on the SAME host share one cached robots.txt fetch when a shared RobotsCache is passed', async () => {
      const robotsCache: RobotsCache = new Map()
      // Each candidate's own homepage fully resolves (embedded-v1
      // fingerprint + facts, no separate endpoint request) so the ONLY
      // variable being measured is the robots.txt saving, not an
      // incidental floor-plans probe.
      const html = embeddedV1Html(ORLANDO_LD_JSON, '{"units":[{"id_value":1,"bedrooms":"1","bathrooms":"1"}]}')
      const inner = fakeFetcher({
        'https://shared-host.example.com/robots.txt': PERMISSIVE_ROBOTS,
        'https://shared-host.example.com/a': { status: 200, text: html },
        'https://shared-host.example.com/b': { status: 200, text: html },
      })
      const { fetcher, count } = countingFetcher(inner)
      await verifyCandidate({ url: 'https://shared-host.example.com/a', metro: 'Orlando' }, fetcher, { pool, robotsCache })
      const afterFirst = count()
      await verifyCandidate({ url: 'https://shared-host.example.com/b', metro: 'Orlando' }, fetcher, { pool, robotsCache })
      const afterSecond = count()
      // Second candidate costs exactly one more request (its own homepage) —
      // no second robots.txt fetch.
      expect(afterSecond - afterFirst).toBe(1)
    })
  })

  describe('review I8: request budget, verified with a counting fetcher', () => {
    it('robots-disallow costs exactly 1 request', async () => {
      const inner = fakeFetcher({ 'https://budget-a.example.com/robots.txt': DISALLOW_ALL_ROBOTS })
      const { fetcher, count } = countingFetcher(inner)
      const result = await verifyCandidate({ url: 'https://budget-a.example.com/', metro: 'Orlando' }, fetcher, { pool })
      expect(result.verdict).toBe('not_public')
      expect(count()).toBe(1)
    })

    it('the worst full path (no fingerprint on homepage, found via the floor-plans probe, REST mode) costs at most 4 requests', async () => {
      const restFloorplansHtml = {
        status: 200,
        text: `<html><head><script id="x-js-extra">var s={"endpoint":"\\/wp-json\\/entrata\\/v3\\/termrent-floor-plans"};</script></head><body>${ORLANDO_LD_JSON}</body></html>`,
      }
      const inner = fakeFetcher({
        'https://budget-b.example.com/robots.txt': PERMISSIVE_ROBOTS, // 1
        'https://budget-b.example.com/': PLAIN_HOMEPAGE, // 2 — no fingerprint here
        'https://budget-b.example.com/floor-plans/': restFloorplansHtml, // 3 — fingerprint + facts found here
        'https://budget-b.example.com/wp-json/entrata/v3/termrent-floor-plans': { status: 200, body: VALID_REST_PAYLOAD }, // 4
      })
      const { fetcher, count } = countingFetcher(inner)
      const result = await verifyCandidate({ url: 'https://budget-b.example.com/', metro: 'Orlando' }, fetcher, { pool })
      expect(result.verdict).toBe('registered')
      expect(count()).toBeLessThanOrEqual(4)
      expect(count()).toBe(4)
    })
  })
})
