// Search-bar autosuggest. Pure and synchronous — tiny vocabulary, no API
// round-trip. Rule: every suggestion must lead to RESULTS on the live
// corpus; a promoted query landing on "0 listings" reads as a broken site.
// Neighborhoods/amenities beyond "downtown" are out of the vocabulary until
// the corpus can satisfy them (restore from @aptv2/schema's
// NEIGHBORHOOD_ALIASES / AMENITY_KEYWORDS).

export type Suggestion = {
  label: string;
  kind: "filter" | "neighborhood" | "example";
  /** The full query after accepting this suggestion. */
  apply: string;
};

// Verified against prod 2026-08-28: 20 / 21 / 8 / 8 results.
export const EXAMPLE_QUERIES = [
  "2 bed downtown",
  "furnished 1 bed under $2,500",
  "2 bed under $2,200",
  "studio under $2,000",
];

// Filters the parser maps to hard SQL predicates that the scraped corpus
// can actually satisfy: beds, price caps, furnished.
const CANDIDATES: Array<{ label: string; kind: Suggestion["kind"]; terms: string[] }> = [
  { label: "studio", kind: "filter", terms: ["studio"] },
  { label: "1 bed", kind: "filter", terms: ["1 bed", "1br", "1 br"] },
  { label: "2 bed", kind: "filter", terms: ["2 bed", "2br", "2 br"] },
  { label: "3 bed", kind: "filter", terms: ["3 bed", "3br", "3 br"] },
  { label: "furnished", kind: "filter", terms: ["furnished"] },
  { label: "under $2,000", kind: "filter", terms: ["under $2,000"] },
  { label: "under $2,500", kind: "filter", terms: ["under $2,500"] },
  // The one neighborhood with live inventory (verified 2026-08-28).
  { label: "downtown", kind: "neighborhood", terms: ["downtown", "downtown orlando", "cbd"] },
];

/**
 * Complete the trailing fragment of `input` against the vocabulary:
 * "furnished 2 b" → "furnished 2 bed". Longest fragment wins;
 * an empty input offers example queries instead.
 */
export function buildSuggestions(input: string, limit = 6): Suggestion[] {
  const trimmed = input.trim();
  if (!trimmed) {
    return EXAMPLE_QUERIES.slice(0, limit).map((q) => ({ label: q, kind: "example", apply: q }));
  }
  const raw = input.replace(/\s+$/, "");
  const lower = raw.toLowerCase();

  const wordStarts: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== " " && (i === 0 || raw[i - 1] === " ")) wordStarts.push(i);
  }

  // Connective words a query naturally passes through ("2 bed in …") —
  // completing them mid-thought produces nonsense like "in-unit laundry".
  const STOPWORDS = new Set(["in", "near", "with", "under", "a", "an", "the", "and", "at"]);

  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const start of wordStarts) {
    const fragment = lower.slice(start);
    if (fragment.length < 2 && trimmed.length > 1) continue;
    if (STOPWORDS.has(fragment) && start > 0) continue;
    for (const c of CANDIDATES) {
      if (seen.has(c.label)) continue;
      if (!c.terms.some((t) => t.startsWith(fragment))) continue;
      const apply = raw.slice(0, start) + c.label;
      if (apply.trim().toLowerCase() === trimmed.toLowerCase()) continue; // already fully typed
      seen.add(c.label);
      out.push({ label: c.label, kind: c.kind, apply });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
