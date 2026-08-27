// MOCK implementation of SearchService for the UI skeleton.
// The real `search` module (spec §3.1) replaces this file wholesale:
// query parse becomes a cached Haiku structured-output call (§6.1),
// retrieval becomes SQL over `listings`, ranking stays a linear blend.
// The keyword parse below is a deterministic stand-in so the parse-echo
// UI has real structure to render.

import { AMENITY_KEYWORDS, NEIGHBORHOOD_ALIASES, makeListings } from "./fixtures";
import type {
  Listing,
  ParsedQuery,
  SearchResult,
  SearchService,
} from "./types";

export function parseQueryMock(raw: string): ParsedQuery {
  const q = raw.toLowerCase();

  const neighborhoods = Object.entries(NEIGHBORHOOD_ALIASES)
    .filter(([, aliases]) => aliases.some((a) => q.includes(a)))
    .map(([name]) => name);

  const priceMatch = q.match(
    /(?:under|below|less than|<=?|max)\s*\$?\s*([\d,]+)\s*(k?)/,
  );
  let priceMax: number | null = null;
  if (priceMatch) {
    const n = Number(priceMatch[1].replace(/,/g, ""));
    priceMax = priceMatch[2] === "k" ? n * 1000 : n;
  }

  let bedsMin: number | null = null;
  if (/\bstudio\b/.test(q)) bedsMin = 0;
  const bedsMatch = q.match(/(\d)\s*(?:br|bed|beds|bedroom|bedrooms)\b/);
  if (bedsMatch) bedsMin = Number(bedsMatch[1]);

  const furnished = /\bunfurnished\b/.test(q)
    ? false
    : /\bfurnished\b/.test(q)
      ? true
      : null;

  const shortTerm = /short[\s-]?term|month[\s-]?to[\s-]?month/.test(q)
    ? true
    : null;

  const amenities = Object.entries(AMENITY_KEYWORDS)
    .filter(([, keywords]) => keywords.some((k) => q.includes(k)))
    .map(([name]) => name);

  const recognizedAnything =
    neighborhoods.length > 0 ||
    priceMax !== null ||
    bedsMin !== null ||
    furnished !== null ||
    shortTerm !== null ||
    amenities.length > 0;

  return {
    neighborhoods,
    priceMax,
    bedsMin,
    furnished,
    shortTerm,
    amenities,
    // Fail-open ladder (§6.1): nothing recognized → raw text runs as FTS.
    residualText: recognizedAnything ? "" : raw.trim(),
    failedOpen: !recognizedAnything && raw.trim().length > 0,
    parseSource: "fallback" as const,
    parseMs: 0,
  };
}

function matches(listing: Listing, p: ParsedQuery): boolean {
  if (
    p.neighborhoods.length > 0 &&
    !p.neighborhoods.includes(listing.neighborhood)
  ) {
    return false;
  }
  // Undisclosed prices are never dropped by a price filter — they rank
  // last with a "price not listed" badge instead (§6.2).
  if (p.priceMax !== null && listing.price !== null && listing.price > p.priceMax) {
    return false;
  }
  if (p.bedsMin !== null && listing.beds < p.bedsMin) return false;
  if (p.furnished !== null && listing.furnished !== p.furnished) return false;
  if (p.shortTerm !== null && listing.shortTermOk !== p.shortTerm) return false;
  if (p.amenities.length > 0) {
    if (!p.amenities.every((a) => listing.amenities.includes(a))) return false;
  }
  if (p.residualText) {
    const haystack =
      `${listing.propertyName} ${listing.neighborhood} ${listing.description ?? ""}`.toLowerCase();
    const words = p.residualText.toLowerCase().split(/\s+/);
    if (!words.some((w) => haystack.includes(w))) return false;
  }
  return true;
}

export class MockSearchService implements SearchService {
  async search(rawQuery: string): Promise<SearchResult> {
    const now = new Date();
    const parsed = parseQueryMock(rawQuery);
    const all = makeListings(now).filter((l) => l.status !== "gone");

    const hits = rawQuery.trim()
      ? all.filter((l) => matches(l, parsed))
      : all;

    hits.sort((a, b) => {
      // Undisclosed-price listings sink to the bottom (§6.2).
      if ((a.price === null) !== (b.price === null)) {
        return a.price === null ? 1 : -1;
      }
      return b.score.total - a.score.total;
    });

    return { listings: hits, parsed, totalCount: hits.length };
  }

  async getListing(id: string): Promise<Listing | null> {
    const now = new Date();
    return makeListings(now).find((l) => l.id === id) ?? null;
  }
}

export const searchService: SearchService = new MockSearchService();
