// Spherexx-built marketing sites (ZRS and other FL managers run on the
// vendor) render floorplans as server-side <article> cards whose data-*
// attributes carry the pricing story, including the base-rent vs
// advertised split and mandatory monthly fees. One polite GET of
// /floorplans/ yields the available set at floorplan granularity.

import { coerceMaxRps, sha256Json } from './politeness'
import { EntrataPayloadError, type EntrataUnit } from './entrata'
import type { Adapter } from './types'

/** Extracted card record — the stored snapshot payload shape. */
export type SpherexxCard = {
  fp: string
  name: string
  minPriceDollars: number | null
  maxPriceDollars: number | null
  basePriceDollars: number | null
  feeTotalDollars: number | null
  sqft: number | null
  beds: number
  baths: number
  unitsAvailable: number
  pricedOn: string | null
  detailPath: string | null
  /** From the plan's detail page (schema.org Floorplan LD): real prose. */
  description: string | null
}

const CARD_RE = /<article class="floorplans__floorplan[^"]*"([^>]*)>([\s\S]*?)<\/article>/g

/** Community-level facts from a detail page's ApartmentComplex JSON-LD. */
export type SpherexxCommunity = {
  description: string | null
  amenities: string[]
  petsAllowed: boolean | null
}

const LD_RE = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g
const asString = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

/**
 * Detail pages carry two schema.org JSON-LD blocks: a Floorplan (real plan
 * prose) and an ApartmentComplex (community description, amenity list,
 * petsAllowed). Returns both — the plan description keyed by plan name.
 */
export function extractSpherexxDetails(html: string): {
  planDescriptions: Map<string, string>
  community: SpherexxCommunity
} {
  const planDescriptions = new Map<string, string>()
  const community: SpherexxCommunity = { description: null, amenities: [], petsAllowed: null }
  for (const m of html.matchAll(LD_RE)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(m[1]!)
    } catch {
      continue
    }
    const blocks = Array.isArray(parsed) ? parsed : [parsed]
    for (const b of blocks) {
      if (b === null || typeof b !== 'object') continue
      const d = b as Record<string, unknown>
      const type = Array.isArray(d['@type']) ? d['@type'][0] : d['@type']
      if (type === 'Floorplan') {
        const name = asString(d.name)
        const desc = asString(d.description)
        if (name && desc) planDescriptions.set(name, desc)
      } else if (type === 'ApartmentComplex') {
        community.description = asString(d.description) ?? community.description
        community.petsAllowed = typeof d.petsAllowed === 'boolean' ? d.petsAllowed : community.petsAllowed
        if (Array.isArray(d.amenityFeature)) {
          for (const a of d.amenityFeature) {
            const s = asString(typeof a === 'string' ? a : (a as Record<string, unknown>)?.name)
            if (s) community.amenities.push(s)
          }
        }
      }
    }
  }
  return { planDescriptions, community }
}

const attr = (attrs: string, key: string): string | null => {
  const m = attrs.match(new RegExp(`data-${key}="([^"]*)"`))
  return m ? m[1]! : null
}

const num = (v: string | null): number | null => {
  if (v === null || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Pulls the available-floorplan cards out of a Spherexx floorplans page.
 * Throws {@link EntrataPayloadError} when no cards are present — the same
 * wrong-shape signal the Entrata embedded extractors give the verifier.
 */
export function extractSpherexxCards(html: string): SpherexxCard[] {
  const cards: SpherexxCard[] = []
  for (const m of html.matchAll(CARD_RE)) {
    const attrs = m[1]!
    const body = m[2]!
    const fp = attr(attrs, 'fp')
    const name = attr(attrs, 'name')
    if (fp === null || fp === '' || name === null || name === '') continue
    // Beds/baths come from the card's own text — section chrome lists
    // every bed type as navigation.
    const bedsMatch = body.match(/(\d)\s*BED/i)
    const bathsMatch = body.match(/(\d(?:\.\d)?)\s*Bath/i)
    if (bedsMatch === null || bathsMatch === null) continue
    const detail = body.match(/href="(\/floorplans\/[^"]+)"/)
    cards.push({
      fp,
      name,
      minPriceDollars: num(attr(attrs, 'min-price')),
      maxPriceDollars: num(attr(attrs, 'max-price')),
      basePriceDollars: num(attr(attrs, 'base-price')),
      feeTotalDollars: num(attr(attrs, 'fee-total')),
      sqft: num(attr(attrs, 'min-sqft')),
      beds: Number(bedsMatch[1]!),
      baths: Number(bathsMatch[1]!),
      unitsAvailable: num(attr(attrs, 'units-available')) ?? 0,
      pricedOn: attr(attrs, 'date'),
      detailPath: detail ? detail[1]! : null,
      description: null,
    })
  }
  if (cards.length === 0) {
    throw new EntrataPayloadError('no spherexx floorplan cards found')
  }
  return cards
}

const dollarsToCents = (d: number): number => Math.round(d * 100)

// Spherexx emits price 0 as its no-current-pricing sentinel; a zero (or
// negative) dollar figure is "undisclosed", never a real rent. Applied at
// the parse stage so stored payloads repair on reprocess.
const priceOrNull = (d: number | null | undefined): number | null =>
  d == null || d <= 0 ? null : d
/** Stored snapshot payload: index cards enriched with detail-page facts. */
export type SpherexxPayload = {
  cards: SpherexxCard[]
  community: SpherexxCommunity
}

/** Maps the extracted cards onto the shared scraper unit record. */
export function parseSpherexxPayload(payload: unknown, baseUrl?: string): EntrataUnit[] {
  // Shape v1 (pre-detail-pages) was a bare card array; v2 wraps it with
  // community-level facts. Both parse.
  let cards: unknown
  let community: Partial<SpherexxCommunity> = {}
  if (Array.isArray(payload)) {
    cards = payload
  } else if (payload !== null && typeof payload === 'object' && Array.isArray((payload as SpherexxPayload).cards)) {
    cards = (payload as SpherexxPayload).cards
    community = (payload as SpherexxPayload).community ?? {}
  } else {
    throw new EntrataPayloadError('spherexx payload is neither card array nor { cards, community }')
  }
  const units: EntrataUnit[] = []
  for (const raw of cards as unknown[]) {
    if (raw === null || typeof raw !== 'object') {
      throw new EntrataPayloadError('spherexx card is not an object')
    }
    const c = raw as Partial<SpherexxCard>
    if (!c.fp || !c.name || typeof c.beds !== 'number' || typeof c.baths !== 'number') {
      throw new EntrataPayloadError('spherexx card missing fp/name/beds/baths')
    }
    const minPrice = priceOrNull(c.minPriceDollars)
    const maxPrice = priceOrNull(c.maxPriceDollars)
    const basePrice = priceOrNull(c.basePriceDollars)
    const marketing: string[] = [`${c.unitsAvailable} unit(s) available`]
    // Hand the fee split to extraction as text so the true-cost math can use it.
    if (basePrice != null && c.feeTotalDollars != null && c.feeTotalDollars > 0) {
      marketing.push(
        `Base rent $${basePrice}/mo plus $${c.feeTotalDollars}/mo mandatory fees`,
      )
    }
    if (minPrice != null && maxPrice != null && maxPrice > minPrice) {
      marketing.push(`advertised range $${minPrice}–$${maxPrice}/mo`)
    }
    // Detail-page prose (plan description first — it's plan-specific), then
    // community-level facts shared by every plan.
    if (c.description) marketing.push(c.description)
    if (community.description) marketing.push(community.description)
    if (community.petsAllowed === true) marketing.push('Pets allowed')
    if (community.petsAllowed === false) marketing.push('Pets not allowed')
    const amenityTexts = [...(community.amenities ?? [])]
    units.push({
      externalId: String(c.fp),
      floorplanName: String(c.name),
      unitNumber: null, // floorplan granularity — "starting at" pricing
      beds: c.beds,
      baths: c.baths,
      sqft: c.sqft ?? null,
      rentCents: minPrice == null ? null : dollarsToCents(minPrice),
      rentSpecialCents: null,
      availableOn: null,
      amenityTexts,
      marketingTexts: marketing,
      detailUrl:
        c.detailPath && baseUrl ? new URL(c.detailPath, baseUrl).toString() : (c.detailPath ?? null),
      imageUrl: null, // the card's <noscript> thumbnail is a resize proxy; skip until needed
    })
  }
  return units
}

export const spherexxAdapter: Adapter = {
  platform: 'spherexx',
  async fetch(source, fetcher) {
    const maxRps = coerceMaxRps(source.rate_limit_rps)
    const res = await fetcher.fetchText(source.endpoint_config.endpoint_url, source.robots_policy, { maxRps })
    if (res.status !== 200) {
      throw new Error(`spherexx fetch failed: HTTP ${res.status} for ${source.endpoint_config.endpoint_url}`)
    }
    const cards = extractSpherexxCards(res.body)
    // Each plan's DETAIL page carries schema.org JSON-LD: a Floorplan block
    // with real plan prose and an ApartmentComplex block with the community
    // description, amenity list, and petsAllowed. These N polite follow-ups
    // (rate-gated per host like every fetch) are what turns the sparse
    // index cards into enrichable text. A failed/unreachable detail page
    // degrades that plan to index-only — never fails the snapshot.
    const community: SpherexxCommunity = { description: null, amenities: [], petsAllowed: null }
    const base = source.endpoint_config.endpoint_url
    for (const card of cards) {
      if (!card.detailPath) continue
      try {
        const detailUrl = new URL(card.detailPath, base).toString()
        const d = await fetcher.fetchText(detailUrl, source.robots_policy, { maxRps })
        if (d.status !== 200) continue
        const { planDescriptions, community: c } = extractSpherexxDetails(d.body)
        card.description = planDescriptions.get(card.name) ?? null
        if (community.description === null) community.description = c.description
        if (community.petsAllowed === null) community.petsAllowed = c.petsAllowed
        if (community.amenities.length === 0) community.amenities = c.amenities
      } catch {
        // detail page unreachable/robots-blocked: plan stays index-only
      }
    }
    const payload: SpherexxPayload = { cards, community }
    return {
      source_id: source.id,
      content_hash: sha256Json(payload),
      payload,
    }
  },
}
