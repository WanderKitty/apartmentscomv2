// Domain types now live in @aptv2/schema (shared with pipeline + search).
// This shim keeps the app's "@/lib/types" import path stable.
export type {
  Listing,
  ListingStatus,
  PriceChange,
  ScoreComponents,
  TrueCost,
  UiListingEvent as ListingEvent,
  ParsedQuery,
  SearchResult,
  SearchService,
} from "@aptv2/schema";

// Admin / ops (§8) — read model over sources + scrape_runs. Web-local.
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
