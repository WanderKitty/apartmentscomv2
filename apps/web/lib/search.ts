import { buildSeedUnits, toListing } from "@aptv2/schema";
import { parseQuery } from "./parse/llm-parse";
import type { Listing, ParsedQuery, SearchResult, SearchService } from "./types";

// In-memory corpus, built once per server process. Honest demo scope:
// this is the SearchService seam the spec (§3.1) says Postgres replaces.
function corpus(now: Date): Listing[] {
  return buildSeedUnits(now).map((u) => toListing(u, now));
}

export function matches(l: Listing, p: ParsedQuery): boolean {
  if (p.neighborhoods.length > 0 && !p.neighborhoods.includes(l.neighborhood)) return false;
  if (p.priceMax !== null && l.price !== null && l.price > p.priceMax) return false; // null price passes — badged, ranked last
  if (p.bedsMin !== null && l.beds < p.bedsMin) return false;
  if (p.furnished !== null && l.furnished !== p.furnished) return false;
  if (p.shortTerm !== null && l.shortTermOk !== p.shortTerm) return false;
  for (const a of p.amenities) if (!l.amenities.includes(a)) return false;
  if (p.residualText) {
    const hay = `${l.propertyName} ${l.neighborhood} ${l.description ?? ""}`.toLowerCase();
    if (!p.residualText.toLowerCase().split(/\s+/).some((w) => hay.includes(w))) return false;
  }
  return true;
}

const FRESHNESS_HALF_LIFE_DAYS = 3; // spec §5.5
function score(l: Listing, now: Date): Listing {
  const ageDays = (now.getTime() - new Date(l.lastConfirmedAt).getTime()) / 86_400_000;
  const freshness = Math.pow(0.5, ageDays / FRESHNESS_HALF_LIFE_DAYS);
  const trust =
    (l.price !== null ? 0.35 : 0) +
    (!l.priceIsStartingAt && l.price !== null ? 0.25 : 0) +
    (l.sqft !== null ? 0.15 : 0) +
    (l.description ? 0.15 : 0) +
    (l.amenities.length > 0 ? 0.1 : 0);
  const total = 0.45 * freshness + 0.45 * trust + 0.1 * (l.events.length >= 3 ? 1 : 0);
  return { ...l, score: { textRelevance: 0, freshness, trust, proximity: 0, total } };
}

/**
 * B1: collapse duplicate physical units AFTER matching. Cheapest advertised
 * price becomes the primary card; the rest survive as alsoListedOn entries.
 * Information is never dropped.
 */
function collapseDuplicates(listings: Listing[]): Listing[] {
  const byCluster = new Map<string, Listing[]>();
  for (const l of listings) {
    const group = byCluster.get(l.dedupCluster) ?? [];
    group.push(l);
    byCluster.set(l.dedupCluster, group);
  }
  const out: Listing[] = [];
  for (const group of byCluster.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    const sorted = [...group].sort(
      (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    );
    const [primary, ...rest] = sorted;
    out.push({
      ...primary,
      alsoListedOn: rest.map((r) => ({ platform: r.platform, price: r.price })),
    });
  }
  return out;
}

const recentSearchMs: number[] = [];
function recordP50(ms: number): number {
  recentSearchMs.push(ms);
  if (recentSearchMs.length > 100) recentSearchMs.shift();
  const sorted = [...recentSearchMs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export const searchService: SearchService = {
  async search(rawQuery: string): Promise<SearchResult> {
    const now = new Date();
    const parsed = await parseQuery(rawQuery);
    const t0 = performance.now();
    const all = corpus(now);
    const scored = all.filter((l) => matches(l, parsed)).map((l) => score(l, now));
    const collapsed = collapseDuplicates(scored);
    collapsed.sort((a, b) => {
      if ((a.price === null) !== (b.price === null)) return a.price === null ? 1 : -1; // undisclosed price last
      return b.score.total - a.score.total;
    });
    const searchMs = Math.round((performance.now() - t0) * 100) / 100;
    return {
      listings: collapsed,
      parsed,
      totalCount: collapsed.length,
      timing: { parseMs: parsed.parseMs, searchMs, p50SearchMs: recordP50(searchMs), corpus: all.length },
    };
  },

  async getListing(id: string): Promise<Listing | null> {
    const now = new Date();
    return corpus(now).map((l) => score(l, now)).find((l) => l.id === id) ?? null;
  },
};
