import { sha256Json, type PoliteFetcher } from './politeness'
import type { Adapter, RawSnapshotInput, SourceRow } from './types'

export class EntrataPayloadError extends Error {
  constructor(message: string) {
    super(`Entrata payload error: ${message}`)
    this.name = 'EntrataPayloadError'
  }
}

/** Same field contract regardless of which of the two fetch shapes below produced it. */
export type EntrataUnit = {
  externalId: string
  floorplanName: string | null
  unitNumber: string | null
  beds: number
  baths: number
  sqft: number | null
  rentCents: number | null
  availableOn: string | null
  amenityTexts: string[]
  marketingTexts: string[]
  detailUrl: string | null
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object'
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

function toNumberOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function dollarsToCents(v: unknown): number | null {
  const n = toNumberOrNull(v)
  return n === null ? null : Math.round(n * 100)
}

// ---------------------------------------------------------------------
// Shape 1 (REST): Current Orlando's standalone JSON endpoint returns an
// array of lease-term groups; each group's `bedrooms` is an array of
// arrays of floorplan records. No per-unit granularity — beds/baths/
// sqft/rent are per FLOORPLAN, not per physical unit (unitNumber is
// always null for this shape).
// ---------------------------------------------------------------------

function mapFloorplanRecord(fp: unknown, path: string): EntrataUnit {
  if (!isObj(fp)) throw new EntrataPayloadError(`floorplan record at ${path} is not an object`)

  const idRaw = fp.ID
  if (idRaw === undefined || idRaw === null || idRaw === '') {
    throw new EntrataPayloadError(`missing ID at ${path}`)
  }
  const beds = toNumberOrNull(fp.unit_bedrooms)
  if (beds === null) throw new EntrataPayloadError(`missing/invalid unit_bedrooms at ${path}`)
  const baths = toNumberOrNull(fp.unit_bathrooms)
  if (baths === null) throw new EntrataPayloadError(`missing/invalid unit_bathrooms at ${path}`)

  const termRent = Array.isArray(fp.term_rent) ? (fp.term_rent as Obj[]) : []
  const first = termRent[0]
  // Base asking rent (not the discounted "special" rate, if any — the
  // special number alone has no explanatory text and belongs to a later
  // enrichment step, not this pure mapping).
  const rentCents = first ? dollarsToCents(first.rent) : null

  const tags = Array.isArray(fp.tags) ? (fp.tags as Obj[]) : []
  const marketingTexts = [fp.banner, fp.disclaimer, fp.description, ...termRent.map((t) => t.message), ...tags.map((t) => t.name)].filter(
    isNonEmptyString,
  )

  const featuredImage = isObj(fp.featured_image) ? fp.featured_image : null
  const detailUrl = featuredImage && isNonEmptyString(featuredImage.link) ? featuredImage.link : null

  return {
    externalId: String(idRaw),
    floorplanName: isNonEmptyString(fp.name) ? fp.name : null,
    unitNumber: null,
    beds,
    baths,
    sqft: toNumberOrNull(fp.squarefeet_min),
    rentCents,
    availableOn: null, // this endpoint carries no availability date
    amenityTexts: [], // no amenity-attribute field on this endpoint
    marketingTexts,
    detailUrl,
  }
}

function parseFloorplanGroupsShape(groups: unknown[]): EntrataUnit[] {
  const units: EntrataUnit[] = []
  groups.forEach((group, gi) => {
    if (!isObj(group)) throw new EntrataPayloadError(`lease-term group at [${gi}] is not an object`)
    const bedroomGroups = group.bedrooms
    if (!Array.isArray(bedroomGroups)) throw new EntrataPayloadError(`missing bedrooms array at [${gi}]`)
    bedroomGroups.forEach((fpList, bi) => {
      if (!Array.isArray(fpList)) throw new EntrataPayloadError(`bedrooms[${bi}] at group [${gi}] is not an array`)
      fpList.forEach((fp, fi) => units.push(mapFloorplanRecord(fp, `[${gi}].bedrooms[${bi}][${fi}]`)))
    })
  })
  return units
}

// ---------------------------------------------------------------------
// Shape 2 (embedded): Society Orlando, Aperture, and Knightsbridge embed
// a `jd-fp-data-script-app` widget-config object in their floor-plans
// HTML page. Unlike shape 1, this config carries a flat `units` array
// with genuine per-unit granularity: apartment number, available date,
// and a `.amenities[].name` free-text list (in this capture, used by the
// property for marketing/specials copy rather than physical amenities).
// ---------------------------------------------------------------------

function mapUnitRecord(u: unknown, path: string): EntrataUnit {
  if (!isObj(u)) throw new EntrataPayloadError(`unit record at ${path} is not an object`)

  const idRaw = u.id_value ?? u.id
  if (idRaw === undefined || idRaw === null || idRaw === '') {
    throw new EntrataPayloadError(`missing id_value/id at ${path}`)
  }
  const bedsRaw = u.bedrooms
  const beds = typeof bedsRaw === 'string' && bedsRaw.trim().toLowerCase() === 'studio' ? 0 : toNumberOrNull(bedsRaw)
  if (beds === null) throw new EntrataPayloadError(`missing/invalid bedrooms at ${path}`)
  const baths = toNumberOrNull(u.bathrooms)
  if (baths === null) throw new EntrataPayloadError(`missing/invalid bathrooms at ${path}`)

  const priceEntity = isObj(u.price_entity) ? u.price_entity : null
  const rentCents =
    priceEntity && typeof priceEntity.priceLow === 'number' ? Math.round(priceEntity.priceLow * 100) : dollarsToCents(u.rent_min)

  const availDate = toNumberOrNull(u.available_date)
  const availableOn = availDate && availDate > 0 ? new Date(availDate * 1000).toISOString().slice(0, 10) : null

  const amenities = Array.isArray(u.amenities) ? (u.amenities as Obj[]) : []
  const marketingTexts = amenities.map((a) => a.name).filter(isNonEmptyString)

  return {
    externalId: String(idRaw),
    floorplanName: isNonEmptyString(u.floorplan_title) ? u.floorplan_title : null,
    unitNumber: isNonEmptyString(u.apartment_number) ? u.apartment_number : null,
    beds,
    baths,
    sqft: toNumberOrNull(u.square_feet),
    rentCents,
    availableOn,
    amenityTexts: [], // no separate physical-amenity field distinct from the marketing list below
    marketingTexts,
    detailUrl: isNonEmptyString(u.permalink) ? u.permalink : null,
  }
}

function parseEmbeddedUnitsShape(payload: Obj): EntrataUnit[] {
  const units = payload.units
  if (!Array.isArray(units)) throw new EntrataPayloadError('missing units array')
  return units.map((u, i) => mapUnitRecord(u, `units[${i}]`))
}

/**
 * Pure; no network. Dispatches on payload shape: an array of lease-term
 * groups (shape 1, REST) or an object with a `units` array (shape 2,
 * embedded widget config). Throws `EntrataPayloadError` naming the
 * missing field on an unrecognized or malformed payload.
 */
export function parseEntrataPayload(payload: unknown): EntrataUnit[] {
  if (Array.isArray(payload)) return parseFloorplanGroupsShape(payload)
  if (isObj(payload) && Array.isArray(payload.units)) return parseEmbeddedUnitsShape(payload)
  throw new EntrataPayloadError(
    'unrecognized payload shape (expected an array of lease-term groups, or an object with a units array)',
  )
}

const EMBEDDED_JSON_RE = /<script[^>]*id="jd-fp-data-script-app"[^>]*>([\s\S]*?)<\/script>/

function extractEmbeddedJson(html: string): unknown {
  const m = html.match(EMBEDDED_JSON_RE)
  if (!m) throw new EntrataPayloadError('no embedded jd-fp-data-script-app JSON found in HTML body')
  return JSON.parse(m[1]!)
}

export const entrataAdapter: Adapter = {
  platform: 'entrata',
  async fetch(source: SourceRow, fetcher: PoliteFetcher): Promise<RawSnapshotInput> {
    const res = await fetcher.fetchText(source.endpoint_config.endpoint_url, source.robots_policy)
    if (res.status !== 200) {
      throw new Error(`entrata fetch failed: HTTP ${res.status} for ${source.endpoint_config.endpoint_url}`)
    }
    let payload: unknown
    try {
      payload = JSON.parse(res.body)
    } catch {
      payload = extractEmbeddedJson(res.body)
    }
    return {
      source_id: source.id,
      content_hash: sha256Json(payload),
      payload,
    }
  },
}
