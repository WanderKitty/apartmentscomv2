import { AMENITY_KEYWORDS, NEIGHBORHOOD_ALIASES, type ParsedQuery } from "@aptv2/schema";

/** Deterministic keyword rung of the fail-open ladder (spec §6.1). */
export function parseQueryKeywords(raw: string): ParsedQuery {
  const q = raw.toLowerCase();

  const neighborhoods = Object.entries(NEIGHBORHOOD_ALIASES)
    .filter(([, aliases]) => aliases.some((a) => q.includes(a)))
    .map(([name]) => name);

  const priceMatch = q.match(
    /(?:under|below|less than|<=?|max)\s*\$?\s*([\d,]+)\s*(k?)/,
  );
  let priceMax: number | null = null;
  if (priceMatch) {
    const n = Number(priceMatch[1]!.replace(/,/g, ""));
    priceMax = priceMatch[2] === "k" ? n * 1000 : n;
  }

  // Plain "1 bedroom" means EXACTLY one; only an explicit "1+", "at least",
  // or "or more" phrasing leaves the upper bound open (user ruling).
  let bedsMin: number | null = null;
  let bedsMax: number | null = null;
  if (/\bstudio\b/.test(q)) {
    bedsMin = 0;
    bedsMax = 0;
  }
  const bedsMatch = q.match(/(\d)\s*\+?\s*(?:br|bed|beds|bedroom|bedrooms)\b/);
  if (bedsMatch) {
    bedsMin = Number(bedsMatch[1]!);
    const openEnded =
      new RegExp(`${bedsMatch[1]}\\s*\\+`).test(q) ||
      /at least|or more|minimum/.test(q);
    bedsMax = openEnded ? null : bedsMin;
  }

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
    bedsMax,
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
