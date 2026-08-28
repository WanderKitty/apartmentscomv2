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
}

const CARD_RE = /<article class="floorplans__floorplan[^"]*"([^>]*)>([\s\S]*?)<\/article>/g

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

/** Maps the extracted cards onto the shared scraper unit record. */
export function parseSpherexxPayload(payload: unknown, baseUrl?: string): EntrataUnit[] {
  if (!Array.isArray(payload)) {
    throw new EntrataPayloadError('spherexx payload is not an array')
  }
  const units: EntrataUnit[] = []
  for (const raw of payload) {
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
      amenityTexts: [],
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
    const payload = extractSpherexxCards(res.body)
    return {
      source_id: source.id,
      content_hash: sha256Json(payload),
      payload,
    }
  },
}
