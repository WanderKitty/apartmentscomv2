// Domain types for the web module, mirroring the data model in
// docs/superpowers/specs/2026-08-27-apartment-aggregator-design.md §4.
// The web module reads listings ONLY through SearchService (§3.1) —
// swap MockSearchService for the real `search` module implementation.

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

export interface ListingEvent {
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
  events: ListingEvent[];
  trueCost: TrueCost | null;
  provenance: "seed" | "scraped";
  daysOnMarket: number;
  /** Other sources advertising the same physical unit (dedup collapse). */
  alsoListedOn: Array<{ platform: string; price: number | null }>;
  /** liberal_dedup_cluster carried through for the search-layer collapse. */
  dedupCluster: string;
}

/** Output of the query-parse step (§6.1). */
export interface ParsedQuery {
  neighborhoods: string[];
  priceMax: number | null;
  bedsMin: number | null;
  furnished: boolean | null;
  shortTerm: boolean | null;
  amenities: string[];
  residualText: string;
  /** True when the parse fail-open ladder kicked in (raw text as FTS). */
  failedOpen: boolean;
}

export interface SearchResult {
  listings: Listing[];
  parsed: ParsedQuery;
  totalCount: number;
}

export interface SearchService {
  search(rawQuery: string): Promise<SearchResult>;
  getListing(id: string): Promise<Listing | null>;
}

// Admin / ops (§8) — read model over sources + scrape_runs.
export interface SourceHealth {
  id: string;
  name: string;
  platform: string;
  enabled: boolean;
  lastScrapedAt: string | null;
  failureStreak: number;
  activeListings: number;
  listingDelta24h: number;
}
