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
} from '@aptv2/scrapers'
import { FLORIDA_CITIES } from '@aptv2/schema'
import { fingerprintEntrata } from './fingerprint'
import { extractPropertyFacts, type LlmFactsExtractor, type GeocodeFn } from './facts'

// The verifier program (spec §7, Task 5 Global Constraints): every network
// request goes through the injected politeness fetcher, robots is checked
// FIRST, and at most 4 requests are made per candidate (robots, homepage,
// one optional secondary "endpoint probe" page, one optional contact/about
// page) — accounted for explicitly below via `requestsUsed`. Sequential by
// construction: this function makes one candidate's requests one at a time
// and returns; discover-cli is responsible for not running candidates
// concurrently.

export type Candidate = { url: string; metro: string; note?: string }

export type VerifyVerdict = 'registered' | 'not_entrata' | 'not_public' | 'no_endpoint' | 'no_facts' | 'out_of_scope'

export type VerifyResult = { url: string; verdict: VerifyVerdict; detail: string }

export type VerifyDeps = {
  pool: pg.Pool
  llm?: LlmFactsExtractor
  geocode?: GeocodeFn
}

const NOT_PUBLIC_DETAIL = 'not publicly accessible' // the ONLY permitted characterization, anywhere (Global Constraints)
const MAX_REQUESTS = 4

const PERMISSIVE_POLICY: RobotsPolicy = { disallow: [], allow: [], crawlDelaySeconds: null }

function result(url: string, verdict: VerifyVerdict, detail: string): VerifyResult {
  return { url, verdict, detail }
}

export async function verifyCandidate(candidate: Candidate, fetcher: PoliteFetcher, deps: VerifyDeps): Promise<VerifyResult> {
  const origin = new URL(candidate.url).origin
  let requestsUsed = 0

  // 1) robots.txt FIRST — exempt from its own gating (policy: null).
  let policy: RobotsPolicy = PERMISSIVE_POLICY
  try {
    const robotsRes = await fetcher.fetchText(`${origin}/robots.txt`, null)
    requestsUsed++
    if (robotsRes.status === 200) policy = parseRobots(robotsRes.body, USER_AGENT)
  } catch {
    // robots.txt unreachable → treat as permissive (matches "missing robots.txt = fully allowed")
  }
  if (!isPathAllowed(policy, new URL(candidate.url).pathname || '/')) {
    return result(candidate.url, 'not_public', NOT_PUBLIC_DETAIL)
  }

  // 2) Homepage (the candidate's own URL).
  let homepageHtml: string
  try {
    const res = await fetcher.fetchText(candidate.url, policy)
    requestsUsed++
    if (res.status === 401 || res.status === 403) return result(candidate.url, 'not_public', NOT_PUBLIC_DETAIL)
    if (res.status !== 200) return result(candidate.url, 'not_entrata', `homepage returned HTTP ${res.status}`)
    homepageHtml = res.body
  } catch (e) {
    if (e instanceof RobotsDisallowedError) return result(candidate.url, 'not_public', NOT_PUBLIC_DETAIL)
    return result(candidate.url, 'not_entrata', `homepage unreachable: ${(e as Error).message}`)
  }

  // 3) Fingerprint the homepage; if not found, try one conventional
  // secondary page (/floor-plans/) as a combined fingerprint + endpoint probe.
  let primaryHtml = homepageHtml
  let primaryUrl = candidate.url
  let fp = fingerprintEntrata(homepageHtml)
  if (!fp.isEntrata) {
    const floorplansUrl = `${origin}/floor-plans/`
    if (floorplansUrl !== candidate.url && requestsUsed < MAX_REQUESTS) {
      try {
        const res = await fetcher.fetchText(floorplansUrl, policy)
        requestsUsed++
        if (res.status === 200) {
          const fp2 = fingerprintEntrata(res.body)
          if (fp2.isEntrata) {
            fp = fp2
            primaryHtml = res.body
            primaryUrl = floorplansUrl
          }
        }
      } catch {
        // robots-disallowed or unreachable secondary page: not fatal, just no fingerprint found here
      }
    }
  }
  if (!fp.isEntrata) {
    return result(candidate.url, 'not_entrata', 'no Entrata fingerprint found on homepage or /floor-plans/')
  }

  // 4) Resolve + validate the actual availability payload. REST mode needs
  // one more request (the discovered JSON endpoint); embedded modes already
  // carry their data in `primaryHtml` — no extra request needed.
  let endpointUrl = primaryUrl
  if (fp.mode === 'rest') {
    endpointUrl = new URL(fp.endpointPath!, origin).toString()
    if (requestsUsed >= MAX_REQUESTS) return result(candidate.url, 'no_endpoint', 'request budget exhausted before endpoint probe')
    try {
      const res = await fetcher.fetchJson(endpointUrl, policy)
      requestsUsed++
      if (res.status !== 200) return result(candidate.url, 'no_endpoint', `endpoint returned HTTP ${res.status}`)
      parseEntrataPayload(res.body, endpointUrl) // throws on unrecognized/malformed shape
    } catch (e) {
      return result(candidate.url, 'no_endpoint', `endpoint probe failed: ${(e as Error).message}`)
    }
  } else {
    try {
      const payload = extractEmbeddedJson(primaryHtml)
      parseEntrataPayload(payload, primaryUrl) // throws on unrecognized/malformed shape
    } catch (e) {
      return result(candidate.url, 'no_endpoint', `embedded payload invalid: ${(e as Error).message}`)
    }
  }

  // 5) Property facts: deterministic/LLM on the primary page, falling back
  // to one contact/about page if budget allows and nothing was found.
  let geocoded = false
  const geocodeDep: GeocodeFn | undefined = deps.geocode
    ? async (q) => {
        const r = await deps.geocode!(q)
        if (r) geocoded = true
        return r
      }
    : undefined

  let facts = await extractPropertyFacts(primaryHtml, primaryUrl, { llm: deps.llm, geocode: geocodeDep })
  if (!facts && requestsUsed < MAX_REQUESTS) {
    const contactUrl = `${origin}/contact/`
    try {
      const res = await fetcher.fetchText(contactUrl, policy)
      requestsUsed++
      if (res.status === 200) {
        facts = await extractPropertyFacts(res.body, contactUrl, { llm: deps.llm, geocode: geocodeDep })
      }
    } catch {
      // robots-disallowed or unreachable contact page: falls through to no_facts below
    }
  }
  if (!facts) return result(candidate.url, 'no_facts', 'could not determine property name/address from any fetched page')

  // 6) Scope gate.
  if (!(FLORIDA_CITIES as readonly string[]).includes(facts.city)) {
    return result(candidate.url, 'out_of_scope', `city "${facts.city}" is not in FLORIDA_CITIES scope`)
  }

  // 7) Register (idempotent by website_url).
  const endpointConfig = {
    endpoint_url: endpointUrl,
    mode: fp.mode,
    property: facts,
  }
  await deps.pool.query(
    `INSERT INTO sources (platform, name, website_url, endpoint_config, robots_policy, rate_limit_rps, enabled)
     VALUES ('entrata', $1, $2, $3, $4, 1, true)
     ON CONFLICT (website_url) DO NOTHING`,
    [facts.name, candidate.url, JSON.stringify(endpointConfig), JSON.stringify(policy)],
  )

  return result(candidate.url, 'registered', `registered (mode=${fp.mode}, geocoded=${geocoded})`)
}
