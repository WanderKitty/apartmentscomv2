import type pg from 'pg'
import {
  USER_AGENT,
  RobotsDisallowedError,
  parseRobots,
  isPathAllowed,
  parseEntrataPayload,
  extractEmbeddedJson,
  type PoliteFetcher,
  type RobotsPolicy,
  extractSpherexxCards,
  parseSpherexxPayload,
} from '@aptv2/scrapers'
import { FLORIDA_CITIES } from '@aptv2/schema'
import { fingerprintEntrata } from './fingerprint'
import { extractCoreFacts, type LlmFactsExtractor, type GeocodeFn } from './facts'

// Candidate verifier: every network request goes through the injected
// politeness fetcher, robots is checked FIRST, and at most 4 requests are
// made per candidate — `requestsUsed` is incremented BEFORE each await so a
// throwing request still counts. One candidate's requests run sequentially;
// discover-cli is responsible for not running candidates concurrently.

export type Candidate = { url: string; metro: string; note?: string }

// 'unreachable': reachability could not be established (robots.txt
// 403/5xx/throw, or the homepage itself throws) — distinct from
// 'not_entrata', which asserts we DID reach the site.
export type VerifyVerdict =
  | 'registered'
  | 'not_entrata'
  | 'not_public'
  | 'unreachable'
  | 'no_endpoint'
  | 'no_facts'
  | 'out_of_scope'

export type VerifyResult = { url: string; verdict: VerifyVerdict; detail: string }

export type RobotsCacheEntry = { kind: 'ok'; policy: RobotsPolicy } | { kind: 'unreachable' }
/** Per-host robots.txt memoization, keyed by origin: N candidates on the
 * same host cost one robots.txt fetch per discover-cli run, not N. */
export type RobotsCache = Map<string, RobotsCacheEntry>

export type VerifyDeps = {
  pool: pg.Pool
  llm?: LlmFactsExtractor
  geocode?: GeocodeFn
  /** Shared across a discover-cli run (see `RobotsCache`); defaults to a
   * fresh call-local Map when omitted. */
  robotsCache?: RobotsCache
}

const NOT_PUBLIC_DETAIL = 'not publicly accessible' // the ONLY permitted characterization of a gated site, anywhere
const UNREACHABLE_DETAIL = 'unreachable at verification time'
const MAX_REQUESTS = 4

const PERMISSIVE_POLICY: RobotsPolicy = { disallow: [], allow: [], crawlDelaySeconds: null }

function result(url: string, verdict: VerifyVerdict, detail: string): VerifyResult {
  return { url, verdict, detail }
}

/** Normalizes to a trailing slash so relative resolution treats the
 * candidate's own path as a DIRECTORY: `https://mgmt.co/properties/slug`
 * must probe `.../slug/floor-plans/`, not `.../properties/floor-plans/` —
 * the latter is wrong for every multi-property site on one domain. */
function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

export async function verifyCandidate(candidate: Candidate, fetcher: PoliteFetcher, deps: VerifyDeps): Promise<VerifyResult> {
  const u = new URL(candidate.url)
  const origin = u.origin
  const candidateBase = withTrailingSlash(candidate.url)
  const robotsCache: RobotsCache = deps.robotsCache ?? new Map()
  let requestsUsed = 0

  // 1) robots.txt FIRST — exempt from its own gating (policy: null);
  // memoized per host.
  let policy: RobotsPolicy;
  {
    const cached = robotsCache.get(origin)
    if (cached) {
      if (cached.kind === 'unreachable') return result(candidate.url, 'unreachable', UNREACHABLE_DETAIL)
      policy = cached.policy
    } else {
      policy = PERMISSIVE_POLICY
      requestsUsed++ // charged before the await: a throw must still count
      try {
        const robotsRes = await fetcher.fetchText(`${origin}/robots.txt`, null)
        // REP treats a server error fetching robots.txt as temporary full
        // disallow — conservative on first contact. A plain 404 (no
        // robots.txt at all) is the normal, permissive case.
        if (robotsRes.status === 403 || (robotsRes.status >= 500 && robotsRes.status < 600)) {
          robotsCache.set(origin, { kind: 'unreachable' })
          return result(candidate.url, 'unreachable', UNREACHABLE_DETAIL)
        }
        if (robotsRes.status === 200) policy = parseRobots(robotsRes.body, USER_AGENT)
        robotsCache.set(origin, { kind: 'ok', policy })
      } catch {
        // Network error or retry-exhaustion throw — robots.txt could not
        // be established at all.
        robotsCache.set(origin, { kind: 'unreachable' })
        return result(candidate.url, 'unreachable', UNREACHABLE_DETAIL)
      }
    }
  }
  // Google REP matches path+query, not path alone (matches politeness.ts's
  // own gate).
  if (!isPathAllowed(policy, u.pathname + u.search)) {
    return result(candidate.url, 'not_public', NOT_PUBLIC_DETAIL)
  }

  // 2) Homepage (the candidate's own URL).
  let homepageHtml: string
  requestsUsed++ // charged before the await
  try {
    const res = await fetcher.fetchText(candidate.url, policy)
    if (res.status === 401 || res.status === 403) return result(candidate.url, 'not_public', NOT_PUBLIC_DETAIL)
    // Any other non-200 here means we DID reach the site — it just isn't
    // showing us content (a genuine "not Entrata" finding), unlike a throw
    // below (5xx/429/network — we learned nothing).
    if (res.status !== 200) return result(candidate.url, 'not_entrata', `homepage returned HTTP ${res.status}`)
    homepageHtml = res.body
  } catch (e) {
    if (e instanceof RobotsDisallowedError) return result(candidate.url, 'not_public', NOT_PUBLIC_DETAIL)
    return result(candidate.url, 'unreachable', UNREACHABLE_DETAIL)
  }

  // 3) Fingerprint the homepage; if not found, try one conventional
  // secondary page (candidate-relative "floor-plans/") as a combined
  // fingerprint + endpoint probe.
  let primaryHtml = homepageHtml
  let primaryUrl = candidate.url
  let fp = fingerprintEntrata(homepageHtml)
  if (!fp.isEntrata) {
    // Two conventional secondary paths, budget-gated, first hit wins:
    // "floor-plans/" (Entrata WP shapes) and "floorplans/" (Spherexx). A
    // second probe displaces the optional contact page — ≤4 still holds.
    for (const probe of ['floor-plans/', 'floorplans/']) {
      const floorplansUrl = new URL(probe, candidateBase).toString()
      if (floorplansUrl === candidate.url || requestsUsed >= MAX_REQUESTS) continue
      requestsUsed++
      try {
        const res = await fetcher.fetchText(floorplansUrl, policy)
        if (res.status === 200) {
          const fp2 = fingerprintEntrata(res.body)
          if (fp2.isEntrata) {
            fp = fp2
            primaryHtml = res.body
            primaryUrl = floorplansUrl
            break
          }
        }
      } catch {
        // robots-disallowed or unreachable secondary page: not fatal, just no fingerprint found here
      }
    }
  }
  if (!fp.isEntrata) {
    return result(candidate.url, 'not_entrata', 'no Entrata fingerprint found on homepage or conventional floorplans paths')
  }

  // 4) Resolve + validate the actual availability payload. REST mode needs
  // one more request (the discovered JSON endpoint); embedded modes already
  // carry their data in `primaryHtml` — no extra request needed.
  let endpointUrl = primaryUrl
  if (fp.mode === 'rest') {
    endpointUrl = new URL(fp.endpointPath!, candidateBase).toString()
    if (requestsUsed >= MAX_REQUESTS) return result(candidate.url, 'no_endpoint', 'request budget exhausted before endpoint probe')
    requestsUsed++
    try {
      const res = await fetcher.fetchJson(endpointUrl, policy)
      if (res.status !== 200) return result(candidate.url, 'no_endpoint', `endpoint returned HTTP ${res.status}`)
      parseEntrataPayload(res.body, endpointUrl) // throws on unrecognized/malformed shape
    } catch (e) {
      return result(candidate.url, 'no_endpoint', `endpoint probe failed: ${(e as Error).message}`)
    }
  } else if (fp.mode === 'spherexx') {
    try {
      // Spherexx cards are server-rendered HTML — extract, then validate
      // through the same parser the scrape worker will use.
      const payload = extractSpherexxCards(primaryHtml)
      parseSpherexxPayload(payload, primaryUrl)
    } catch (e) {
      return result(candidate.url, 'no_endpoint', `spherexx payload invalid: ${(e as Error).message}`)
    }
  } else {
    try {
      const payload = extractEmbeddedJson(primaryHtml)
      parseEntrataPayload(payload, primaryUrl) // throws on unrecognized/malformed shape
    } catch (e) {
      return result(candidate.url, 'no_endpoint', `embedded payload invalid: ${(e as Error).message}`)
    }
  }

  // 5) Core (non-geo) property facts: deterministic/LLM on the primary
  // page, falling back to one contact/about page if budget allows.
  // Geocoding is deferred until AFTER the scope gate — an out-of-scope
  // candidate must burn zero Nominatim requests.
  let coreResult = await extractCoreFacts(primaryHtml, { llm: deps.llm })
  if (!coreResult && requestsUsed < MAX_REQUESTS) {
    const contactUrl = new URL('contact/', candidateBase).toString()
    requestsUsed++
    try {
      const res = await fetcher.fetchText(contactUrl, policy)
      if (res.status === 200) {
        coreResult = await extractCoreFacts(res.body, { llm: deps.llm })
      }
    } catch {
      // robots-disallowed or unreachable contact page: falls through to no_facts below
    }
  }
  if (!coreResult) return result(candidate.url, 'no_facts', 'could not determine property name/address from any fetched page')
  const { core } = coreResult

  // 6) Scope gate — BEFORE geocoding.
  if (core.state !== 'FL' || !(FLORIDA_CITIES as readonly string[]).includes(core.city)) {
    return result(candidate.url, 'out_of_scope', `"${core.city}, ${core.state}" is not in FLORIDA_CITIES scope`)
  }

  // 7) Coordinates: deterministic geo if the LD+JSON path had it, else the
  // Nominatim fallback (only reached for in-scope candidates).
  let geo = coreResult.geo
  let geocoded = false
  if (!geo && deps.geocode) {
    try {
      const g = await deps.geocode(`${core.address_line1}, ${core.city}, ${core.state} ${core.zip}`)
      if (g) {
        geo = g
        geocoded = true
      }
    } catch {
      // fail-open: a geocode error just leaves coordinates missing
    }
  }
  if (!geo) return result(candidate.url, 'no_facts', 'property facts found but no coordinates could be determined')
  const facts = { ...core, ...geo }

  // 8) Register (idempotent by website_url).
  const endpointConfig = {
    endpoint_url: endpointUrl,
    mode: fp.mode,
    property: facts,
  }
  await deps.pool.query(
    `INSERT INTO sources (platform, name, website_url, endpoint_config, robots_policy, rate_limit_rps, enabled)
     VALUES ($5, $1, $2, $3, $4, 1, true)
     ON CONFLICT (website_url) DO NOTHING`,
    [facts.name, candidate.url, JSON.stringify(endpointConfig), JSON.stringify(policy), fp.mode === 'spherexx' ? 'spherexx' : 'entrata'],
  )

  return result(candidate.url, 'registered', `registered (mode=${fp.mode}, geocoded=${geocoded})`)
}
