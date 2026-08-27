// Invented Orlando fixture data for the UI skeleton. Property names and
// URLs are fictional; photoUrl is null because real photos are linked from
// source sites at runtime, never bundled. Timestamps are generated relative
// to `now` so freshness labels stay realistic.

import type { Listing, SourceHealth } from "./types";
import { buildSeedUnits, toListing } from "@aptv2/schema";

export { NEIGHBORHOOD_ALIASES, AMENITY_KEYWORDS } from "@aptv2/schema";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function makeListings(now: Date): Listing[] {
  return buildSeedUnits(now).map((u) => toListing(u, now));
}

export function makeSources(now: Date): SourceHealth[] {
  const t = now.getTime();
  const ago = (ms: number) => new Date(t - ms).toISOString();

  return [
    {
      id: "src-camellia",
      name: "The Camellia at Lake Eola",
      platform: "rentcafe",
      enabled: true,
      lastScrapedAt: ago(2 * HOUR),
      failureStreak: 0,
      activeListings: 14,
      listingDelta24h: 1,
    },
    {
      id: "src-marlowe",
      name: "Marlowe Thornton Park",
      platform: "rentcafe",
      enabled: true,
      lastScrapedAt: ago(6 * HOUR),
      failureStreak: 0,
      activeListings: 9,
      listingDelta24h: 0,
    },
    {
      id: "src-porchlight",
      name: "Porchlight College Park",
      platform: "appfolio",
      enabled: true,
      lastScrapedAt: ago(11 * HOUR),
      failureStreak: 0,
      activeListings: 6,
      listingDelta24h: -1,
    },
    {
      id: "src-verano",
      name: "Verano Baldwin Park",
      platform: "rentcafe",
      enabled: true,
      lastScrapedAt: ago(27 * HOUR),
      failureStreak: 2,
      activeListings: 21,
      listingDelta24h: -6,
    },
    {
      id: "src-nona-grove",
      name: "Nona Grove Apartments",
      platform: "rentcafe",
      enabled: true,
      lastScrapedAt: ago(4 * DAY),
      failureStreak: 9,
      activeListings: 11,
      listingDelta24h: 0,
    },
    {
      id: "src-solara",
      name: "Solara SoDo",
      platform: "entrata",
      enabled: false,
      lastScrapedAt: ago(12 * DAY),
      failureStreak: 0,
      activeListings: 3,
      listingDelta24h: 0,
    },
  ];
}
