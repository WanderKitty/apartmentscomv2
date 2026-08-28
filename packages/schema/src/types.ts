// Domain types for the web module, mirroring the data model in
// docs/superpowers/specs/2026-08-27-apartment-aggregator-design.md §4.
// The web module reads listings ONLY through SearchService (§3.1); the
// Postgres-backed implementation lives in @aptv2/search.

export type ListingStatus = "active" | "stale" | "gone";

export interface PriceChange {
  at: string; // ISO datetime
  from: number;
  to: number;
}

export interface ScoreComponents {
  textRelevance: number;
  freshness: number;
  trust: number;
  proximity: number;
  total: number;
}

export interface TrueCost {
  advertisedMonthly: number;           // dollars
  concessionLabel: string;             // e.g. "6 wk free ÷ 13 mo"
  concessionMonthly: number;           // dollars saved per month (positive)
  netEffectiveMonthly: number;         // dollars
  moveInFees: Array<{ label: string; amount: number }>; // one-time, dollars
}

export interface UiListingEvent {
  at: string; // ISO datetime
  kind: "first_listed" | "price_drop" | "price_increase" | "concession_added" | "concession_removed" | "confirmed";
  fromCents: number | null;
  toCents: number | null;
  note: string | null;
}

export interface Listing {
  id: string;
  propertyId: string;
  propertyName: string;
  neighborhood: string;
  /** Display fallback when neighborhood is empty (Plan 6 Task 4). */
  city: string;
  address: string;
  beds: number; // 0 = studio
  baths: number;
  sqft: number | null;
  /** Monthly rent in whole dollars. null = price not disclosed by the source. */
  price: number | null;
  priceIsStartingAt: boolean;
  concessionsText: string | null;
  /** Parsed at ingest from concessions; null when no concessions. */
  netEffectiveRent: number | null;
  availableDate: string | null; // ISO date
  furnished: boolean;
  shortTermOk: boolean;
  status: ListingStatus;
  firstListedAt: string; // ISO datetime
  lastConfirmedAt: string; // ISO datetime — drives freshness
  priceHistory: PriceChange[];
  /** Linked from the source site, never rehosted (§7). */
  photoUrl: string | null;
  sourceUrl: string;
  platform: string;
  amenities: string[];
  description: string | null;
  score: ScoreComponents;
  events: UiListingEvent[];
  trueCost: TrueCost | null;
  provenance: "seed" | "scraped";
  daysOnMarket: number;
  /** Other sources advertising the same physical unit (dedup collapse). */
  alsoListedOn: Array<{ platform: string; price: number | null }>;
  /** liberal_dedup_cluster carried through for the search-layer collapse. */
  dedupCluster: string;
  /** WGS84 coordinates for the map view. null when the source had no location. */
  lat: number | null;
  lng: number | null;
}

/** Output of the query-parse step (§6.1). */
export interface ParsedQuery {
  neighborhoods: string[];
  /** Closed enum (FLORIDA_CITIES). Neighborhood aliases take precedence
   * when both could match the same text. */
  cities: string[];
  priceMax: number | null;
  bedsMin: number | null;
  /**
   * Upper bound on bedrooms. A plain "1 bedroom" query means EXACTLY one
   * (bedsMin === bedsMax === 1); "1+ br" / "at least 1" leaves this null.
   */
  bedsMax: number | null;
  furnished: boolean | null;
  shortTerm: boolean | null;
  amenities: string[];
  /**
   * Ordering intent. Filters constrain WHICH listings match; sort says in
   * what order they render. "cheapest" is a sort, not a price filter — it
   * must never surface as priceMax, and it must not fall through to the
   * residual-text FTS gate either.
   */
  sort:
    | "relevance"
    | "price_asc"
    | "price_desc"
    | "newest"
    | "sqft_asc"
    | "sqft_desc";
  residualText: string;
  /** True when the parse fail-open ladder kicked in (raw text as FTS). */
  failedOpen: boolean;
  /** Which rung produced this parse. */
  parseSource: "llm" | "cache" | "fallback";
  /** Wall-clock ms spent parsing (0 on cache hits). */
  parseMs: number;
}

export interface SearchResult {
  listings: Listing[];
  parsed: ParsedQuery;
  totalCount: number;
  /**
   * Populated only when totalCount is 0 and at least one filter was active:
   * which SINGLE filter removal would yield results, with the count it
   * unlocks and a rebuilt query string for a one-click retry. Empty
   * otherwise — the non-empty path pays zero extra queries.
   */
  relaxationHints: Array<{ drop: string; label: string; count: number; suggestedQuery: string }>;
  /**
   * Boundaries of the neighborhoods the parse matched, for the map view.
   * Empty when no neighborhood filter is active — the common path pays
   * zero extra queries.
   */
  neighborhoodBoundaries: Array<{
    name: string;
    geojson: { type: "MultiPolygon"; coordinates: number[][][][] };
  }>;
  timing: {
    parseMs: number;
    searchMs: number;
    p50SearchMs: number;
    corpus: number; // total active listings searched (seed + scraped)
    corpusSeed: number; // active listings with provenance = 'seed'
    corpusScraped: number; // active listings with provenance = 'scraped'
  };
}

export interface SearchService {
  search(rawQuery: string): Promise<SearchResult>;
  getListing(id: string): Promise<Listing | null>;
}
