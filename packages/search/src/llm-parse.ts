import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AMENITY_KEYWORDS, NEIGHBORHOOD_ALIASES, type ParsedQuery } from "@aptv2/schema";
import { parseQueryKeywords } from "./keyword-parse";

const NEIGHBORHOODS = Object.keys(NEIGHBORHOOD_ALIASES) as [string, ...string[]];
const AMENITIES = Object.keys(AMENITY_KEYWORDS) as [string, ...string[]];

const LlmParseSchema = z.object({
  neighborhoods: z.array(z.enum(NEIGHBORHOODS)),
  price_max_dollars: z.number().int().positive().nullable(),
  beds_min: z.number().int().min(0).max(6).nullable(),
  beds_max: z.number().int().min(0).max(6).nullable(),
  furnished: z.boolean().nullable(),
  short_term: z.boolean().nullable(),
  amenities: z.array(z.enum(AMENITIES)),
  residual_text: z.string(),
});

const SYSTEM = `You convert one apartment-search query into filters. Extract ONLY constraints the user actually stated; use null for anything not stated. Neighborhoods must come from this exact list (map colloquial names onto them, e.g. "near lake eola" → "Lake Eola Heights"): ${NEIGHBORHOODS.join("; ")}. Amenities must come from this exact list: ${AMENITIES.join("; ")}. Bedrooms: a plain count means EXACTLY that many — "2br"/"two bed" → beds_min 2 AND beds_max 2; "studio" → beds_min 0 AND beds_max 0; only an open-ended phrasing ("2+", "at least 2", "2 or more") sets beds_min 2 with beds_max null. Put any leftover free text that expresses a real constraint you could not map into residual_text, else "".`;

// Spec §6.1 budgets 800ms; the demo uses a looser 2500ms so a cold Haiku
// round-trip lands as "llm" rather than falling open mid-demo.
const DEFAULT_TIMEOUT_MS = 2500;

// Guardrails: the query arrives via a public GET parameter. An oversized one
// never reaches the paid LLM rung (no real apartment search needs more), and
// the cache is bounded FIFO so unique-query spam can't grow process memory.
const MAX_LLM_QUERY_CHARS = 300;
const MAX_CACHE_ENTRIES = 500;

const cache = new Map<string, ParsedQuery>();
export function __resetParseCacheForTests(): void {
  cache.clear();
}

const normalize = (raw: string) => raw.toLowerCase().replace(/\s+/g, " ").trim();

type ParseClient = Pick<Anthropic, "messages"> | null;

let defaultClient: ParseClient | undefined;
function getClient(): ParseClient {
  if (defaultClient !== undefined) return defaultClient;
  try {
    defaultClient = new Anthropic(); // resolves ANTHROPIC_API_KEY / ant profile
  } catch {
    defaultClient = null; // no credentials → permanent fallback, never an error
  }
  return defaultClient;
}

export async function parseQueryWith(
  raw: string,
  client: ParseClient,
  opts: { timeoutMs?: number } = {},
): Promise<ParsedQuery> {
  const key = normalize(raw);
  const hit = cache.get(key);
  if (hit) return { ...hit, parseSource: "cache", parseMs: 0 };

  const fallback = (): ParsedQuery => parseQueryKeywords(raw);
  if (!client || raw.length > MAX_LLM_QUERY_CHARS) return fallback();

  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const response = await Promise.race([
      client.messages.parse({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: "user", content: raw }],
        output_config: { format: zodOutputFormat(LlmParseSchema) },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("parse-timeout")), timeoutMs);
      }),
    ]);
    const out = response.parsed_output;
    if (!out) return fallback();
    // A successful parse that recognized NOTHING (no filters, no residual)
    // must not become an unconstrained match-everything query — gibberish
    // would return the whole corpus. Run the raw text as keywords instead,
    // exactly like the keyword rung's fail-open ladder (§6.1).
    const recognizedAnything =
      out.neighborhoods.length > 0 ||
      out.price_max_dollars !== null ||
      out.beds_min !== null ||
      out.beds_max !== null ||
      out.furnished !== null ||
      out.short_term !== null ||
      out.amenities.length > 0 ||
      out.residual_text.trim() !== "";
    const parsed: ParsedQuery = {
      neighborhoods: out.neighborhoods,
      priceMax: out.price_max_dollars,
      bedsMin: out.beds_min,
      bedsMax: out.beds_max,
      furnished: out.furnished,
      shortTerm: out.short_term,
      amenities: out.amenities,
      residualText: recognizedAnything ? out.residual_text : raw.trim(),
      failedOpen: !recognizedAnything && raw.trim().length > 0,
      parseSource: "llm",
      parseMs: Math.round(performance.now() - started),
    };
    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(key, parsed);
    return parsed;
  } catch {
    return fallback(); // timeout, network, refusal, anything → keyword rung
  } finally {
    if (timer) clearTimeout(timer); // A6: never leave the race's timer live
  }
}

/** Production entrypoint: real client, default budget. */
export function parseQuery(raw: string): Promise<ParsedQuery> {
  return parseQueryWith(raw, getClient());
}
