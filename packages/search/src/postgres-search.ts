import type pg from 'pg'
import {
  SOURCE_ID_SEPARATOR,
  type Listing,
  type ParsedQuery,
  type SearchResult,
  type SearchService,
  type TrueCost,
  type UiListingEvent,
} from '@aptv2/schema'
import { parseQuery } from './llm-parse'

// Retrieval + ranking per spec §6.2–6.3: one SQL query, hard WHERE
// filters, ST_Covers on neighborhood boundaries, tsquery on residual
// text, linear blend 0.35·text + 0.30·freshness + 0.25·trust +
// 0.10·proximity computed in SQL. Undisclosed price sorts last.
// Dedup collapse (same physical unit, several sources) happens in TS on
// the returned page — the corpus is metro-scale, not web-scale.

const FRESHNESS_HALF_LIFE_SECONDS = 3 * 86_400 // spec §5.5

const SEARCH_SQL = `
SELECT q.*,
       (0.35 * q.text_rel + 0.30 * q.freshness + 0.25 * q.trust_score + 0.10 * q.proximity) AS score_total
FROM (
  SELECT
    l.collapse_key,
    -- dedup_cluster is nullable; a writer that omits it must not collapse
    -- every null-cluster row into a single card, so fall back to the
    -- (unique per row) collapse_key as the grouping key.
    COALESCE(l.dedup_cluster, l.collapse_key) AS dedup_cluster,
    l.source_platform, l.source_external_id,
    l.source_url, l.provenance, l.price_cents, l.price_is_starting_at,
    l.net_effective_rent_cents, l.concessions_text,
    to_char(l.available_on, 'YYYY-MM-DD') AS available_on, l.lease_term,
    l.furnished, l.status, l.first_listed_at, l.last_confirmed_at,
    l.price_history, l.events, l.move_in_fees, l.concession, l.description,
    l.trust_score::float8 AS trust_score,
    u.beds::float8 AS beds, u.baths::float8 AS baths, u.sqft,
    u.amenities AS unit_amenities,
    p.name AS property_name, p.address_line1, p.city, p.state, p.zip,
    p.amenities AS community_amenities,
    n.name AS neighborhood_name,
    ST_Y(l.location::geometry) AS lat, ST_X(l.location::geometry) AS lng,
    CASE WHEN $7 <> ''
         THEN LEAST(1.0, ts_rank(l.search_tsv, plainto_tsquery('english', $7))::float8 * 10)
         ELSE 0 END AS text_rel,
    power(0.5, EXTRACT(EPOCH FROM (now() - l.last_confirmed_at))::float8 / ${FRESHNESS_HALF_LIFE_SECONDS}) AS freshness,
    COALESCE((SELECT GREATEST(0.0,
                1.0 - MIN(ST_Distance(l.location, ST_Centroid(nh.boundary::geometry)::geography))::float8 / 3000.0)
              FROM neighborhoods nh WHERE nh.name = ANY($6::text[])), 0) AS proximity
  FROM listings l
  JOIN units u ON u.id = l.unit_id
  JOIN properties p ON p.id = l.property_id
  LEFT JOIN neighborhoods n ON n.id = l.neighborhood_id
  WHERE l.status = 'active'
    AND ($1::int IS NULL OR l.price_cents IS NULL OR l.price_cents <= $1)
    AND ($2::int IS NULL OR u.beds >= $2)
    AND ($8::int IS NULL OR u.beds <= $8)
    AND ($3::boolean IS NULL OR (l.furnished IS TRUE) = $3)
    AND ($4::boolean IS NULL OR
         (CASE WHEN $4 THEN l.lease_term IN ('short','both')
               ELSE l.lease_term IN ('long','unknown') END))
    AND (cardinality($5::text[]) = 0 OR (u.amenities || p.amenities) @> $5::text[])
    AND (cardinality($6::text[]) = 0 OR EXISTS (
          SELECT 1 FROM neighborhoods nh2
          WHERE nh2.name = ANY($6::text[]) AND ST_Covers(nh2.boundary, l.location)))
    AND ($7 = '' OR l.search_tsv @@ plainto_tsquery('english', $7))
    AND (cardinality($9::text[]) = 0 OR lower(p.city) = ANY($9::text[]))
) q
ORDER BY (q.price_cents IS NULL) ASC, score_total DESC, q.source_platform, q.source_external_id
-- Safety valve: pagination is future work; the returned page is what
-- collapse operates on, so this bounds the collapse/render cost per request.
LIMIT 500
`

const GET_LISTING_SQL = `
SELECT
  l.collapse_key,
  -- dedup_cluster is nullable; a writer that omits it must not collapse
  -- every null-cluster row into a single card, so fall back to the
  -- (unique per row) collapse_key as the grouping key.
  COALESCE(l.dedup_cluster, l.collapse_key) AS dedup_cluster,
  l.source_platform, l.source_external_id,
  l.source_url, l.provenance, l.price_cents, l.price_is_starting_at,
  l.net_effective_rent_cents, l.concessions_text,
  to_char(l.available_on, 'YYYY-MM-DD') AS available_on, l.lease_term,
  l.furnished, l.status, l.first_listed_at, l.last_confirmed_at,
  l.price_history, l.events, l.move_in_fees, l.concession, l.description,
  l.trust_score::float8 AS trust_score,
  u.beds::float8 AS beds, u.baths::float8 AS baths, u.sqft,
  u.amenities AS unit_amenities,
  p.name AS property_name, p.address_line1, p.city, p.state, p.zip,
  p.amenities AS community_amenities,
  n.name AS neighborhood_name,
  ST_Y(l.location::geometry) AS lat, ST_X(l.location::geometry) AS lng,
  0::float8 AS text_rel,
  power(0.5, EXTRACT(EPOCH FROM (now() - l.last_confirmed_at))::float8 / ${FRESHNESS_HALF_LIFE_SECONDS}) AS freshness,
  0::float8 AS proximity,
  (0.30 * power(0.5, EXTRACT(EPOCH FROM (now() - l.last_confirmed_at))::float8 / ${FRESHNESS_HALF_LIFE_SECONDS})
   + 0.25 * l.trust_score::float8) AS score_total
FROM listings l
JOIN units u ON u.id = l.unit_id
JOIN properties p ON p.id = l.property_id
LEFT JOIN neighborhoods n ON n.id = l.neighborhood_id
WHERE l.source_platform = $1 AND l.source_external_id = $2
LIMIT 1
`

type Row = {
  collapse_key: string
  dedup_cluster: string
  source_platform: string
  source_external_id: string
  source_url: string
  provenance: 'seed' | 'scraped'
  price_cents: number | null
  price_is_starting_at: boolean
  net_effective_rent_cents: number | null
  concessions_text: string | null
  available_on: string | null
  lease_term: 'short' | 'long' | 'both' | 'unknown'
  furnished: boolean | null
  status: 'active' | 'stale' | 'gone'
  first_listed_at: Date
  last_confirmed_at: Date
  price_history: Array<{ at: string; from_cents: number; to_cents: number }>
  events: Array<{ at: string; kind: UiListingEvent['kind']; from_cents: number | null; to_cents: number | null; note: string | null }>
  move_in_fees: Array<{ label: string; amount_cents: number }>
  concession: {
    type: 'free_weeks' | 'free_months' | 'flat_discount'
    free_weeks: number | null
    free_months: number | null
    value_cents: number | null
    lease_months: number | null
  } | null
  description: string | null
  trust_score: number
  beds: number
  baths: number
  sqft: number | null
  unit_amenities: string[]
  property_name: string
  address_line1: string
  city: string
  state: string
  zip: string
  community_amenities: string[]
  neighborhood_name: string | null
  lat: number | null
  lng: number | null
  text_rel: number
  freshness: number
  proximity: number
  score_total: number
}

const d = (c: number) => Math.round(c / 100)

// Keep in sync with packages/schema/src/seed.ts's trueCostOf — signatures
// differ (Row vs ProcessedUnitData) so extraction isn't worth it.
function trueCostOf(row: Row): TrueCost | null {
  if (row.price_cents === null) return null
  const fees = row.move_in_fees.map((f) => ({ label: f.label, amount: d(f.amount_cents) }))
  const net = row.net_effective_rent_cents ?? row.price_cents
  const c = row.concession
  const lease = c?.lease_months
  const advertisedMonthly = d(row.price_cents)
  const concessionMonthly = d(row.price_cents - net)
  const label =
    c?.type === 'free_weeks' && lease ? `${c.free_weeks} wk free ÷ ${lease} mo`
    : c?.type === 'free_months' && lease ? `${c.free_months} mo free ÷ ${lease} mo`
    : c?.type === 'flat_discount' && lease ? `$${d(c.value_cents ?? 0)} off ÷ ${lease} mo`
    // A net-effective discount without a structured concession record — e.g.
    // a deterministic "special rate" fact (spec-adjacent to entrata ingestion)
    // rather than an LLM-parsed concession — still deserves a label, not
    // "No concessions".
    : concessionMonthly > 0 ? 'Special rate'
    : 'No concessions'
  return {
    advertisedMonthly,
    concessionLabel: label,
    concessionMonthly,
    // Derived after rounding so displayed arithmetic can never drift $1.
    netEffectiveMonthly: advertisedMonthly - concessionMonthly,
    moveInFees: fees,
  }
}

function rowToListing(row: Row, now: Date): Listing {
  return {
    id: `${row.source_platform}${SOURCE_ID_SEPARATOR}${row.source_external_id}`,
    propertyId: row.collapse_key,
    propertyName: row.property_name,
    neighborhood: row.neighborhood_name ?? '',
    city: row.city,
    address: `${row.address_line1}, ${row.city}, ${row.state} ${row.zip}`,
    beds: row.beds,
    baths: row.baths,
    sqft: row.sqft,
    price: row.price_cents === null ? null : d(row.price_cents),
    priceIsStartingAt: row.price_is_starting_at,
    concessionsText: row.concessions_text,
    netEffectiveRent: row.net_effective_rent_cents === null ? null : d(row.net_effective_rent_cents),
    availableDate: row.available_on,
    furnished: row.furnished === true,
    shortTermOk: row.lease_term === 'short' || row.lease_term === 'both',
    status: row.status,
    firstListedAt: row.first_listed_at.toISOString(),
    lastConfirmedAt: row.last_confirmed_at.toISOString(),
    priceHistory: row.price_history.map((e) => ({ at: e.at, from: d(e.from_cents), to: d(e.to_cents) })),
    photoUrl: null,
    sourceUrl: row.source_url,
    platform: row.source_platform,
    amenities: [...row.unit_amenities, ...row.community_amenities],
    description: row.description,
    score: {
      textRelevance: row.text_rel,
      freshness: row.freshness,
      trust: row.trust_score,
      proximity: row.proximity,
      total: row.score_total,
    },
    events: row.events.map((e) => ({ at: e.at, kind: e.kind, fromCents: e.from_cents, toCents: e.to_cents, note: e.note })),
    trueCost: trueCostOf(row),
    provenance: row.provenance,
    daysOnMarket: Math.max(0, Math.round((now.getTime() - row.first_listed_at.getTime()) / 86_400_000)),
    alsoListedOn: [],
    dedupCluster: row.dedup_cluster,
    lat: row.lat,
    lng: row.lng,
  }
}

/** B1 collapse, ported from the demo: cheapest source is the primary card. */
function collapseDuplicates(listings: Listing[]): Listing[] {
  const byCluster = new Map<string, Listing[]>()
  for (const l of listings) {
    const group = byCluster.get(l.dedupCluster) ?? []
    group.push(l)
    byCluster.set(l.dedupCluster, group)
  }
  const out: Listing[] = []
  for (const group of byCluster.values()) {
    if (group.length === 1) {
      out.push(group[0]!)
      continue
    }
    const sorted = [...group].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
    const [primary, ...rest] = sorted
    out.push({
      ...primary!,
      alsoListedOn: rest.map((r) => ({ platform: r.platform, price: r.price })),
    })
  }
  // Collapse must not reorder the SQL ranking: sort the collapsed set the
  // same way the query did (undisclosed price last, then score).
  out.sort((a, b) => {
    if ((a.price === null) !== (b.price === null)) return a.price === null ? 1 : -1
    return b.score.total - a.score.total
  })
  return out
}

// One COUNT sharing SEARCH_SQL's exact WHERE clause — used only on the
// zero-results path to compute single-filter relaxation hints.
const COUNT_MATCHING_SQL = `
SELECT count(*)::int AS n
FROM listings l
JOIN units u ON u.id = l.unit_id
JOIN properties p ON p.id = l.property_id
WHERE l.status = 'active'
  AND ($1::int IS NULL OR l.price_cents IS NULL OR l.price_cents <= $1)
  AND ($2::int IS NULL OR u.beds >= $2)
  AND ($8::int IS NULL OR u.beds <= $8)
  AND ($3::boolean IS NULL OR (l.furnished IS TRUE) = $3)
  AND ($4::boolean IS NULL OR
       (CASE WHEN $4 THEN l.lease_term IN ('short','both')
             ELSE l.lease_term IN ('long','unknown') END))
  AND (cardinality($5::text[]) = 0 OR (u.amenities || p.amenities) @> $5::text[])
  AND (cardinality($6::text[]) = 0 OR EXISTS (
        SELECT 1 FROM neighborhoods nh2
        WHERE nh2.name = ANY($6::text[]) AND ST_Covers(nh2.boundary, l.location)))
  AND ($7 = '' OR l.search_tsv @@ plainto_tsquery('english', $7))
  AND (cardinality($9::text[]) = 0 OR lower(p.city) = ANY($9::text[]))
`

const searchParams = (p: ParsedQuery) => [
  p.priceMax === null ? null : p.priceMax * 100,
  p.bedsMin,
  p.furnished,
  p.shortTerm,
  p.amenities,
  p.neighborhoods,
  p.residualText,
  p.bedsMax,
  p.cities.map((c) => c.toLowerCase()),
]

type DropCandidate = { drop: string; label: string; strip: (p: ParsedQuery) => ParsedQuery }

function activeDrops(p: ParsedQuery): DropCandidate[] {
  const out: DropCandidate[] = []
  if (p.neighborhoods.length > 0)
    out.push({ drop: 'neighborhoods', label: p.neighborhoods.join(', '), strip: (q) => ({ ...q, neighborhoods: [] }) })
  if (p.cities.length > 0)
    out.push({ drop: 'city', label: p.cities.join(', '), strip: (q) => ({ ...q, cities: [] }) })
  if (p.priceMax !== null)
    out.push({ drop: 'priceMax', label: `Under $${p.priceMax.toLocaleString('en-US')}`, strip: (q) => ({ ...q, priceMax: null }) })
  if (p.bedsMin !== null)
    out.push({
      drop: 'beds',
      label:
        p.bedsMax === p.bedsMin
          ? p.bedsMin === 0
            ? 'Studio'
            : `${p.bedsMin} bd`
          : `${p.bedsMin}+ bd`,
      // Bed bounds travel together: dropping "beds" drops both.
      strip: (q) => ({ ...q, bedsMin: null, bedsMax: null }),
    })
  if (p.furnished !== null)
    out.push({ drop: 'furnished', label: p.furnished ? 'Furnished' : 'Unfurnished', strip: (q) => ({ ...q, furnished: null }) })
  if (p.shortTerm !== null)
    out.push({ drop: 'shortTerm', label: 'Short term', strip: (q) => ({ ...q, shortTerm: null }) })
  for (const a of p.amenities)
    out.push({ drop: `amenity:${a}`, label: a, strip: (q) => ({ ...q, amenities: q.amenities.filter((x) => x !== a) }) })
  return out
}

/** Lossy natural-query reconstruction from the remaining filters. */
function rebuildQuery(p: ParsedQuery): string {
  const parts: string[] = []
  if (p.bedsMin !== null)
    parts.push(p.bedsMin === 0 ? 'studio' : `${p.bedsMin}${p.bedsMax === null ? '+' : ''}br`)
  if (p.neighborhoods.length > 0) parts.push(`in ${p.neighborhoods[0]}`)
  else if (p.cities.length > 0) parts.push(`in ${p.cities[0]}`)
  if (p.priceMax !== null) parts.push(`under $${p.priceMax}`)
  parts.push(...p.amenities)
  if (p.furnished === true) parts.push('furnished')
  if (p.furnished === false) parts.push('unfurnished')
  if (p.shortTerm === true) parts.push('short term')
  return parts.join(' ').trim() || p.residualText
}

const recentSearchMs: number[] = []
function recordP50(ms: number): number {
  recentSearchMs.push(ms)
  if (recentSearchMs.length > 100) recentSearchMs.shift()
  const sorted = [...recentSearchMs].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

export function createSearchService(
  getPool: () => pg.Pool,
  opts: { parse?: (raw: string) => Promise<ParsedQuery> } = {},
): SearchService {
  const parse = opts.parse ?? parseQuery
  return {
    async search(rawQuery: string): Promise<SearchResult> {
      const now = new Date()
      const pool = getPool()
      const parsed = await parse(rawQuery)
      const t0 = performance.now()
      const [{ rows }, corpusRes, boundaryRes] = await Promise.all([
        pool.query<Row>(SEARCH_SQL, searchParams(parsed)),
        pool.query<{ seed: number; scraped: number }>(
          `SELECT count(*) FILTER (WHERE provenance = 'seed')::int AS seed,
                  count(*) FILTER (WHERE provenance = 'scraped')::int AS scraped
           FROM listings WHERE status = 'active'`,
        ),
        // Map overlay: only when the parse matched neighborhoods, so the
        // common path pays zero extra queries.
        parsed.neighborhoods.length > 0
          ? pool.query<{ name: string; geojson: string }>(
              `SELECT name, ST_AsGeoJSON(boundary) AS geojson
               FROM neighborhoods WHERE name = ANY($1::text[])`,
              [parsed.neighborhoods],
            )
          : null,
      ])
      const collapsed = collapseDuplicates(rows.map((r) => rowToListing(r, now)))
      // Zero results with active filters: tell the visitor which SINGLE
      // filter removal would unlock listings — transparency-as-UX, same
      // ethos as the parse echo. Costs queries only on the empty path.
      let relaxationHints: SearchResult['relaxationHints'] = []
      if (collapsed.length === 0) {
        const drops = activeDrops(parsed)
        if (drops.length > 0) {
          const counted = await Promise.all(
            drops.map(async (d) => {
              const stripped = d.strip(parsed)
              const { rows: c } = await pool.query<{ n: number }>(COUNT_MATCHING_SQL, searchParams(stripped))
              return { drop: d.drop, label: d.label, count: c[0]!.n, suggestedQuery: rebuildQuery(stripped) }
            }),
          )
          relaxationHints = counted
            .filter((h) => h.count > 0)
            .sort((a, b) => b.count - a.count)
            .slice(0, 4)
        }
      }
      const searchMs = Math.round((performance.now() - t0) * 100) / 100
      // Spec §6.1: every parse is logged. Awaited for determinism (the
      // insert is sub-ms at this scale) but a logging failure must never
      // fail a search.
      try {
        await pool.query(
          `INSERT INTO search_logs (raw_query, parsed_filters, parse_source, result_count)
           VALUES ($1, $2, $3, $4)`,
          [rawQuery, JSON.stringify(parsed), parsed.parseSource, collapsed.length],
        )
      } catch {
        // counted-visible logging comes with the ops work in a later plan
      }
      return {
        listings: collapsed,
        parsed,
        totalCount: collapsed.length,
        relaxationHints,
        neighborhoodBoundaries: (boundaryRes?.rows ?? []).map((b) => ({
          name: b.name,
          geojson: JSON.parse(b.geojson),
        })),
        timing: {
          parseMs: parsed.parseMs,
          searchMs,
          p50SearchMs: recordP50(searchMs),
          corpus: corpusRes.rows[0]!.seed + corpusRes.rows[0]!.scraped,
          corpusSeed: corpusRes.rows[0]!.seed,
          corpusScraped: corpusRes.rows[0]!.scraped,
        },
      }
    },

    async getListing(id: string): Promise<Listing | null> {
      const sep = id.indexOf(SOURCE_ID_SEPARATOR)
      if (sep < 0) return null
      const platform = id.slice(0, sep)
      const external = id.slice(sep + SOURCE_ID_SEPARATOR.length)
      const { rows } = await getPool().query<Row>(GET_LISTING_SQL, [platform, external])
      const row = rows[0]
      return row ? rowToListing(row, new Date()) : null
    },
  }
}
