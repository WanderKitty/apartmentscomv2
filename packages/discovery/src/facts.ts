// Property-facts extraction: deterministic schema.org LD+JSON first, a
// Haiku fallback on visible page text second (both fail-open), and a
// Nominatim geocode fallback ONLY when coordinates are still missing after
// either path (spec-adjacent, Task 5 Global Constraints).

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'

export type PropertyFacts = {
  name: string
  address_line1: string
  city: string
  state: string
  zip: string
  latitude: number
  longitude: number
}

type FactsCore = Omit<PropertyFacts, 'latitude' | 'longitude'>

export type LlmFactsExtractor = (html: string) => Promise<FactsCore | null>
export type GeocodeFn = (query: string) => Promise<{ latitude: number; longitude: number } | null>

export type FactsDeps = {
  /** Haiku fallback: given the page HTML (typically its visible contact
   * text), returns the core (non-geo) facts, or null if nothing usable is
   * stated. Injected so tests never touch the real API; absence (or an
   * error) fails open — the deterministic result (possibly null) stands. */
  llm?: LlmFactsExtractor
  /** Nominatim fallback, called ONLY when the deterministic/llm result has
   * no coordinates. Injected so tests never hit the real geocoder; caching
   * and rate-limiting are the caller's/deps' responsibility (see geocode.ts). */
  geocode?: GeocodeFn
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object'
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

const LD_JSON_RE = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g

function toNumberOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Flattens an LD+JSON document into a list of candidate entities: either
 * the document itself, or (when it uses `@graph`, as Society Orlando's
 * fixture does) each element of that array. */
function flattenEntities(doc: unknown): Obj[] {
  if (!isObj(doc)) return []
  if (Array.isArray(doc['@graph'])) return (doc['@graph'] as unknown[]).filter(isObj)
  return [doc]
}

function factsFromEntity(entity: Obj): { core: FactsCore; geo: { latitude: number; longitude: number } | null } | null {
  const address = entity.address
  if (!isObj(address)) return null
  const streetAddress = address.streetAddress
  const addressLocality = address.addressLocality
  const addressRegion = address.addressRegion
  const postalCode = address.postalCode
  if (!isStr(streetAddress) || !isStr(addressLocality) || !isStr(addressRegion) || !isStr(postalCode)) return null
  const name = isStr(entity.name) ? entity.name : addressLocality // best-effort: some entities omit name

  const geoObj = entity.geo
  let geo: { latitude: number; longitude: number } | null = null
  if (isObj(geoObj)) {
    const lat = toNumberOrNull(geoObj.latitude)
    const lng = toNumberOrNull(geoObj.longitude)
    if (lat !== null && lng !== null) geo = { latitude: lat, longitude: lng }
  }

  return {
    core: { name, address_line1: streetAddress, city: addressLocality, state: addressRegion, zip: postalCode },
    geo,
  }
}

/** Deterministic path only: scans every LD+JSON block in `html`, returns
 * the first entity whose `address` looks like a usable PostalAddress. */
function extractFromLdJson(html: string): { core: FactsCore; geo: { latitude: number; longitude: number } | null } | null {
  for (const match of html.matchAll(LD_JSON_RE)) {
    let doc: unknown
    try {
      doc = JSON.parse(match[1]!)
    } catch {
      continue // malformed block — try the next one rather than failing the whole page
    }
    for (const entity of flattenEntities(doc)) {
      const found = factsFromEntity(entity)
      if (found) return found
    }
  }
  return null
}

export async function extractPropertyFacts(html: string, _url: string, deps: FactsDeps): Promise<PropertyFacts | null> {
  let core: FactsCore | null = null
  let geo: { latitude: number; longitude: number } | null = null

  const deterministic = extractFromLdJson(html)
  if (deterministic) {
    core = deterministic.core
    geo = deterministic.geo
  } else if (deps.llm) {
    try {
      core = await deps.llm(html)
    } catch {
      core = null // fail-open: an llm error degrades to "no facts", never throws
    }
  }

  if (!core) return null

  if (!geo && deps.geocode) {
    try {
      geo = await deps.geocode(`${core.address_line1}, ${core.city}, ${core.state} ${core.zip}`)
    } catch {
      geo = null // fail-open: a geocode error just leaves coordinates missing
    }
  }

  if (!geo) return null // no facts without coordinates (verifyCandidate's contract requires both)

  return { ...core, ...geo }
}

// ---------------------------------------------------------------------
// Haiku fallback: mirrors packages/pipeline/src/extract.ts's
// createHaikuEnricher (single client.messages.parse call, zodOutputFormat,
// fail-open at construction AND at call time — no key means every
// candidate simply falls through to "no facts" rather than erroring).
// ---------------------------------------------------------------------

const FactsSchema = z.object({
  name: z.string().nullable(),
  address_line1: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zip: z.string().nullable(),
})

const SYSTEM =
  'Extract ONLY the apartment community name and its street address (address line 1, city, state, 2-letter, zip) as stated in this page\'s visible text (e.g. a contact/footer block). null for anything not stated. Never guess.'

const EXTRACT_TIMEOUT_MS = 10_000

/** Returns null without ANTHROPIC_API_KEY (fail-open at construction). */
export function createHaikuFactsExtractor(): LlmFactsExtractor | null {
  if (!process.env.ANTHROPIC_API_KEY) return null
  const client = new Anthropic()
  return async (html: string): Promise<FactsCore | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const response = await Promise.race([
        client.messages.parse({
          model: 'claude-haiku-4-5',
          max_tokens: 1024,
          system: SYSTEM,
          messages: [{ role: 'user', content: html }],
          output_config: { format: zodOutputFormat(FactsSchema) },
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('extract-timeout')), EXTRACT_TIMEOUT_MS)
        }),
      ])
      const out = response.parsed_output
      if (!out || !out.name || !out.address_line1 || !out.city || !out.state || !out.zip) return null
      return { name: out.name, address_line1: out.address_line1, city: out.city, state: out.state, zip: out.zip }
    } catch {
      return null // fail-open: any error (timeout, network, schema) just yields "no facts"
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
