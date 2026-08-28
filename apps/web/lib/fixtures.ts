// Invented Orlando fixture data for the UI skeleton. Property names and
// URLs are fictional; photoUrl is null because real photos are linked from
// source sites at runtime, never bundled. Timestamps are generated relative
// to `now` so freshness labels stay realistic.

import type { Listing } from "./types";
import { buildSeedUnits, toListing } from "@aptv2/schema";

export { NEIGHBORHOOD_ALIASES, AMENITY_KEYWORDS } from "@aptv2/schema";

export function makeListings(now: Date): Listing[] {
  return buildSeedUnits(now).map((u) => toListing(u, now));
}
