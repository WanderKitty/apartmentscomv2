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
  /** A lower, currently-advertised "special" rate, when the source states one distinct from the base rent. */
  rentSpecialCents: number | null
  availableOn: string | null
  amenityTexts: string[]
  marketingTexts: string[]
  detailUrl: string | null
  /** Floorplan image when the source carries one: a photo/render (REST shape's
   * featured_image) or a layout diagram (embedded shape's thumbnail). */
  imageUrl: string | null
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object'
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

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

/** Absolutizes a site-relative path/URL against `baseUrl` (an absolute-path
 * reference, e.g. "/foo/", resolves against the base's origin regardless of
 * the base's own path). Falls back to the raw value when there's no base
 * to resolve against, or the base itself isn't a valid URL. */
function resolveUrl(pathOrUrl: string | null, baseUrl: string | undefined): string | null {
  if (pathOrUrl === null) return null
  if (!baseUrl) return pathOrUrl
  try {
    return new URL(pathOrUrl, baseUrl).toString()
  } catch {
    return pathOrUrl
  }
}

// ---------------------------------------------------------------------
// Shape 1 (REST): Current Orlando's standalone JSON endpoint returns an
// array of lease-term groups; each group's `bedrooms` is an array of
// arrays of floorplan records. No per-unit granularity — beds/baths/
// sqft/rent are per FLOORPLAN, not per physical unit (unitNumber is
// always null for this shape). Floorplan `ID`s are only unique WITHIN a
// lease-term group, so externalId is namespaced with the group's slug
// (e.g. "annual-2127") to avoid collisions across groups.
// ---------------------------------------------------------------------

function mapFloorplanRecord(fp: unknown, path: string, groupSlug: string, baseUrl: string | undefined): EntrataUnit {
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
  const rentCents = first ? dollarsToCents(first.rent) : null
  const rentSpecialCents = first ? dollarsToCents(first.rentspecial) : null

  const tags = Array.isArray(fp.tags) ? (fp.tags as Obj[]) : []
  const marketingTexts = [fp.banner, fp.disclaimer, fp.description, ...termRent.map((t) => t.message), ...tags.map((t) => t.name)].filter(
    isNonEmptyString,
  )

  // The floorplan's own page (not featured_image.link, which is the
  // attachment/image page): observed in this fixture as
  // https://www.currentorlando.com/local-floor-plans/{fp.slug}/ — the
  // same "local-floor-plans/{slug}" segment featured_image.link uses as
  // its own path prefix before the attachment-specific slug.
  const detailUrl = isNonEmptyString(fp.slug) ? resolveUrl(`/local-floor-plans/${fp.slug}/`, baseUrl) : null

  const featuredImage = isObj(fp.featured_image) ? fp.featured_image : null
  const imageUrl = featuredImage && isNonEmptyString(featuredImage.url) ? resolveUrl(featuredImage.url, baseUrl) : null

  return {
    externalId: `${groupSlug}-${String(idRaw)}`,
    floorplanName: isNonEmptyString(fp.name) ? fp.name : null,
    unitNumber: null,
    beds,
    baths,
    sqft: toNumberOrNull(fp.squarefeet_min),
    rentCents,
    rentSpecialCents,
    availableOn: null, // this endpoint carries no availability date
    amenityTexts: [], // no amenity-attribute field on this endpoint
    marketingTexts,
    detailUrl,
    imageUrl,
  }
}

function parseFloorplanGroupsShape(groups: unknown[], baseUrl: string | undefined): EntrataUnit[] {
  const units: EntrataUnit[] = []
  groups.forEach((group, gi) => {
    if (!isObj(group)) throw new EntrataPayloadError(`lease-term group at [${gi}] is not an object`)
    const bedroomGroups = group.bedrooms
    if (!Array.isArray(bedroomGroups)) throw new EntrataPayloadError(`missing bedrooms array at [${gi}]`)
    const groupSlug = isNonEmptyString(group.name) ? slugify(group.name) : `group${gi}`
    bedroomGroups.forEach((fpList, bi) => {
      if (!Array.isArray(fpList)) throw new EntrataPayloadError(`bedrooms[${bi}] at group [${gi}] is not an array`)
      fpList.forEach((fp, fi) => units.push(mapFloorplanRecord(fp, `[${gi}].bedrooms[${bi}][${fi}]`, groupSlug, baseUrl)))
    })
  })
  return units
}

// ---------------------------------------------------------------------
// Shape 2 (embedded): a `jd-fp-data-script-app` widget-config object
// embedded in a floor-plans HTML page. Confirmed handled here: Society
// Orlando's exact capture (`entrata-embedded.html`) — a flat `units`
// array with genuine per-unit granularity (apartment number, available
// date, a `.amenities[].name` free-text list). NOT handled (deferred):
// Aperture's and Knightsbridge's embedded variant, which per the Task 3
// report is a differently-shaped, HTML-entity-encoded array adjacent to
// an `af3_entrata_options` config, not this `jd-fp-data-script-app`
// script tag — a payload in that variant will not match
// `EMBEDDED_JSON_RE` below and will throw. Those two sources are seeded
// with `enabled: false` until a follow-up extractor is built for it.
// ---------------------------------------------------------------------

function mapUnitRecord(u: unknown, path: string, baseUrl: string | undefined): EntrataUnit {
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

  const thumbnail = isObj(u.thumbnail) ? u.thumbnail : null
  const imageUrl = thumbnail && isNonEmptyString(thumbnail.src) ? resolveUrl(thumbnail.src, baseUrl) : null

  return {
    externalId: String(idRaw),
    floorplanName: isNonEmptyString(u.floorplan_title) ? u.floorplan_title : null,
    unitNumber: isNonEmptyString(u.apartment_number) ? u.apartment_number : null,
    beds,
    baths,
    sqft: toNumberOrNull(u.square_feet),
    rentCents,
    rentSpecialCents: null, // this shape has no separate discounted-rate field distinct from price_entity's own range
    availableOn,
    amenityTexts: [], // no separate physical-amenity field distinct from the marketing list below
    marketingTexts,
    detailUrl: resolveUrl(isNonEmptyString(u.permalink) ? u.permalink : null, baseUrl),
    imageUrl,
  }
}

function parseEmbeddedUnitsShape(payload: Obj, baseUrl: string | undefined): EntrataUnit[] {
  const units = payload.units
  if (!Array.isArray(units)) throw new EntrataPayloadError('missing units array')
  return units.map((u, i) => mapUnitRecord(u, `units[${i}]`, baseUrl))
}

/**
 * Pure; no network. Dispatches on payload shape: an array of lease-term
 * groups (shape 1, REST) or an object with a `units` array (shape 2,
 * embedded widget config — Society Orlando's variant only, see the note
 * above). Throws `EntrataPayloadError` naming the missing field on an
 * unrecognized or malformed payload.
 *
 * `baseUrl` (typically the source's `endpoint_config.endpoint_url`) is
 * used only to absolutize site-relative detail-page paths/URLs found in
 * the payload; it never changes which fields are extracted.
 */
export function parseEntrataPayload(payload: unknown, baseUrl?: string): EntrataUnit[] {
  if (Array.isArray(payload)) return parseFloorplanGroupsShape(payload, baseUrl)
  if (isObj(payload) && Array.isArray(payload.units)) return parseEmbeddedUnitsShape(payload, baseUrl)
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
