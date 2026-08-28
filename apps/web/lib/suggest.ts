import { NEIGHBORHOOD_ALIASES, AMENITY_KEYWORDS } from "@aptv2/schema";

// Search-bar autosuggest over data the parser already understands:
// neighborhoods (with aliases), amenities, and canned example queries.
// Pure and synchronous — the vocabulary is tiny, no API round-trip.

export type Suggestion = {
  label: string;
  kind: "neighborhood" | "amenity" | "example";
  /** The full query after accepting this suggestion. */
  apply: string;
};

export const EXAMPLE_QUERIES = [
  "furnished 1br near Lake Eola under $2,000",
  "2 bed in Baldwin Park with a pool",
  "pet friendly studio in College Park",
  "cheapest 2 bed downtown",
];

const CANDIDATES: Array<{ label: string; kind: Suggestion["kind"]; terms: string[] }> = [
  ...Object.entries(NEIGHBORHOOD_ALIASES).map(([label, aliases]) => ({
    label,
    kind: "neighborhood" as const,
    terms: [label.toLowerCase(), ...aliases],
  })),
  ...Object.entries(AMENITY_KEYWORDS).map(([label, keywords]) => ({
    label,
    kind: "amenity" as const,
    terms: [label.toLowerCase(), ...keywords],
  })),
];

/**
 * Complete the trailing fragment of `input` against the vocabulary:
 * "2 bed in bald" → "2 bed in Baldwin Park". Longest fragment wins;
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
