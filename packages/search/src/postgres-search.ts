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
    l.collapse_key, l.dedup_cluster, l.source_platform, l.source_external_id,
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
    AND ($3::boolean IS NULL OR (l.furnished IS TRUE) = $3)
    AND ($4::boolean IS NULL OR
         (CASE WHEN $4 THEN l.lease_term IN ('short','both')
               ELSE l.lease_term IN ('long','unknown') END))
    AND (cardinality($5::text[]) = 0 OR (u.amenities || p.amenities) @> $5::text[])
    AND (cardinality($6::text[]) = 0 OR EXISTS (
          SELECT 1 FROM neighborhoods nh2
          WHERE nh2.name = ANY($6::text[]) AND ST_Covers(nh2.boundary, l.location)))
    AND ($7 = '' OR l.search_tsv @@ plainto_tsquery('english', $7))
) q
ORDER BY (q.price_cents IS NULL) ASC, score_total DESC, q.source_platform, q.source_external_id
`

const GET_LISTING_SQL = `
SELECT
  l.collapse_key, l.dedup_cluster, l.source_platform, l.source_external_id,
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
  text_rel: number
  freshness: number
  proximity: number
  score_total: number
}

const d = (c: number) => Math.round(c / 100)

function trueCostOf(row: Row): TrueCost | null {
  if (row.price_cents === null) return null
  const fees = row.move_in_fees.map((f) => ({ label: f.label, amount: d(f.amount_cents) }))
  const net = row.net_effective_rent_cents ?? row.price_cents
  const c = row.concession
  const lease = c?.lease_months
  const label =
    c?.type === 'free_weeks' && lease ? `${c.free_weeks} wk free ÷ ${lease} mo`
    : c?.type === 'free_months' && lease ? `${c.free_months} mo free ÷ ${lease} mo`
    : c?.type === 'flat_discount' && lease ? `$${d(c.value_cents ?? 0)} off ÷ ${lease} mo`
    : 'No concessions'
  const advertisedMonthly = d(row.price_cents)
  const concessionMonthly = d(row.price_cents - net)
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
      const [{ rows }, corpusRes] = await Promise.all([
        pool.query<Row>(SEARCH_SQL, [
          parsed.priceMax === null ? null : parsed.priceMax * 100,
          parsed.bedsMin,
          parsed.furnished,
          parsed.shortTerm,
          parsed.amenities,
          parsed.neighborhoods,
          parsed.residualText,
        ]),
        pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM listings WHERE status = 'active'`),
      ])
      const collapsed = collapseDuplicates(rows.map((r) => rowToListing(r, now)))
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
        timing: {
          parseMs: parsed.parseMs,
          searchMs,
          p50SearchMs: recordP50(searchMs),
          corpus: corpusRes.rows[0]!.n,
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
