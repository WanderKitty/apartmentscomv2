import { coerceMaxRps, sha256Json, type PoliteFetcher } from './politeness'
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
// Shape 2 (embedded, v1): a `jd-fp-data-script-app` widget-config object
// embedded in a floor-plans HTML page. Confirmed handled here: Society
// Orlando's exact capture (`entrata-embedded.html`) — a flat `units`
// array with genuine per-unit granularity (apartment number, available
// date, a `.amenities[].name` free-text list).
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
  }
}

function parseEmbeddedUnitsShape(payload: Obj, baseUrl: string | undefined): EntrataUnit[] {
  const units = payload.units
  if (!Array.isArray(units)) throw new EntrataPayloadError('missing units array')
  return units.map((u, i) => mapUnitRecord(u, `units[${i}]`, baseUrl))
}

// ---------------------------------------------------------------------
// Shape 3 (embedded, v2): an entity-encoded JSON array in a Vue component
// attribute — `<floor-plan-page-main-component ... :floor_plans='[...]'>`
// — confirmed here on Aperture's real capture (`entrata-embedded-v2.html`).
// Each element is a per-FLOORPLAN record (not per physical unit —
// `available_units` is a count; per-space-option rent variance lives in
// the record's own `lease_options[]`, which this mapping does not expand)
// and is distinguished from shape 1's lease-term-group elements by the
// presence of a `post_id` field. Each record also carries a per-record
// `af3_entrata_options` object naming the pattern (`base_url`,
// `property_id`, `api_url`, ...) — informational only, not consumed here.
//
// Normalization to EntrataUnit: post_id -> externalId; bedrooms/bathrooms
// (numeric strings here, unlike shape 2's "Studio" text) -> beds/baths;
// price_min (plain dollar string, no thousands separator) -> rentCents;
// size_min -> sqft; first_available_date is polymorphic on this fixture
// (`[]` when sold out, a bare "YYYY-MM-DD" string when available) ->
// availableOn; current_special_text -> the sole marketingTexts entry
// (specials[] and the duplicate custom_special_text field were empty/
// identical on every record in the capture, so are not separately
// collected); link_floorplan (falling back to link) -> detailUrl.
// ---------------------------------------------------------------------

function mapV2FloorplanRecord(fp: unknown, path: string, baseUrl: string | undefined): EntrataUnit {
  if (!isObj(fp)) throw new EntrataPayloadError(`v2 floorplan record at ${path} is not an object`)

  const idRaw = fp.post_id
  if (idRaw === undefined || idRaw === null || idRaw === '') {
    throw new EntrataPayloadError(`missing post_id at ${path}`)
  }
  const beds = toNumberOrNull(fp.bedrooms)
  if (beds === null) throw new EntrataPayloadError(`missing/invalid bedrooms at ${path}`)
  const baths = toNumberOrNull(fp.bathrooms)
  if (baths === null) throw new EntrataPayloadError(`missing/invalid bathrooms at ${path}`)

  const firstAvail = fp.first_available_date
  const marketingTexts = [fp.current_special_text].filter(isNonEmptyString)
  const link = isNonEmptyString(fp.link_floorplan) ? fp.link_floorplan : isNonEmptyString(fp.link) ? fp.link : null

  return {
    externalId: String(idRaw),
    floorplanName: isNonEmptyString(fp.title) ? fp.title : null,
    unitNumber: null, // per-floorplan granularity, not per physical unit
    beds,
    baths,
    sqft: toNumberOrNull(fp.size_min),
    rentCents: dollarsToCents(fp.price_min),
    rentSpecialCents: null, // no distinct discounted-rate field on this shape
    availableOn: isNonEmptyString(firstAvail) ? firstAvail : null,
    amenityTexts: [], // no separate physical-amenity field on this shape
    marketingTexts,
    detailUrl: resolveUrl(link, baseUrl),
  }
}

function parseV2FloorplansShape(records: unknown[], baseUrl: string | undefined): EntrataUnit[] {
  return records.map((fp, i) => mapV2FloorplanRecord(fp, `[${i}]`, baseUrl))
}

/**
 * Pure; no network. Dispatches on payload shape: an array of lease-term
 * groups (shape 1, REST), an array of v2 floorplan records identified by
 * a `post_id` field on the first element (shape 3, embedded v2 — see the
 * note above), or an object with a `units` array (shape 2, embedded v1
 * widget config). Throws `EntrataPayloadError` naming the missing field
 * on an unrecognized or malformed payload.
 *
 * `baseUrl` (typically the source's `endpoint_config.endpoint_url`) is
 * used only to absolutize site-relative detail-page paths/URLs found in
 * the payload; it never changes which fields are extracted.
 */
export function parseEntrataPayload(payload: unknown, baseUrl?: string): EntrataUnit[] {
  if (Array.isArray(payload)) {
    if (payload.length > 0 && isObj(payload[0]) && 'post_id' in payload[0]) {
      return parseV2FloorplansShape(payload, baseUrl)
    }
    return parseFloorplanGroupsShape(payload, baseUrl)
  }
  if (isObj(payload) && Array.isArray(payload.units)) return parseEmbeddedUnitsShape(payload, baseUrl)
  throw new EntrataPayloadError(
    'unrecognized payload shape (expected an array of lease-term groups, an array of v2 floorplan records, or an object with a units array)',
  )
}

const EMBEDDED_JSON_RE = /<script[^>]*id="jd-fp-data-script-app"[^>]*>([\s\S]*?)<\/script>/
const V2_EMBEDDED_ATTR_RE = /:floor_plans='([^']*)'/

/** Decodes the HTML entities used to embed JSON inside an attribute value.
 * `&amp;` is decoded FIRST (not last): observed content in the fixture is
 * double-escaped (e.g. the title text's em-dash arrives as literal
 * `&amp;#8211;`), so `&amp;` must unwrap to `&` before the numeric-entity
 * pass below can see `&#8211;` and decode it. Structural quoting
 * (`&quot;`) is only ever single-escaped in this payload, so decoding
 * `&amp;` first doesn't disturb it. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
}

/** Exported for packages/discovery's verifier: lets it validate a candidate's
 * embedded-mode fingerprint match against the SAME already-fetched HTML
 * (no extra network request) using the exact same extraction the real
 * scraper adapter uses below. */
export function extractEmbeddedJson(html: string): unknown {
  const v1 = html.match(EMBEDDED_JSON_RE)
  if (v1) return JSON.parse(v1[1]!)
  const v2 = html.match(V2_EMBEDDED_ATTR_RE)
  if (v2) return JSON.parse(decodeHtmlEntities(v2[1]!))
  throw new EntrataPayloadError(
    'no embedded JSON found in HTML body (tried jd-fp-data-script-app script tag and :floor_plans= entity-encoded attribute)',
  )
}

export const entrataAdapter: Adapter = {
  platform: 'entrata',
  async fetch(source: SourceRow, fetcher: PoliteFetcher): Promise<RawSnapshotInput> {
    const maxRps = coerceMaxRps(source.rate_limit_rps)
    const res = await fetcher.fetchText(source.endpoint_config.endpoint_url, source.robots_policy, { maxRps })
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
