import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AMENITY_KEYWORDS, FLORIDA_CITIES, NEIGHBORHOOD_ALIASES, type ParsedQuery } from "@aptv2/schema";
import { parseQueryKeywords } from "./keyword-parse";

const NEIGHBORHOODS = Object.keys(NEIGHBORHOOD_ALIASES) as [string, ...string[]];
const AMENITIES = Object.keys(AMENITY_KEYWORDS) as [string, ...string[]];
const CITIES = [...FLORIDA_CITIES] as [string, ...string[]];

const LlmParseSchema = z.object({
  neighborhoods: z.array(z.enum(NEIGHBORHOODS)),
  cities: z.array(z.enum(CITIES)),
  price_max_dollars: z.number().int().positive().nullable(),
  beds_min: z.number().int().min(0).max(6).nullable(),
  beds_max: z.number().int().min(0).max(6).nullable(),
  furnished: z.boolean().nullable(),
  short_term: z.boolean().nullable(),
  amenities: z.array(z.enum(AMENITIES)),
  sort: z.enum(["relevance", "price_asc", "price_desc", "newest", "sqft_asc", "sqft_desc"]),
  residual_text: z.string(),
});

const SYSTEM = `You convert one apartment-search query into filters. Extract ONLY constraints the user actually stated; use null for anything not stated. Neighborhoods must come from this exact list (map colloquial names onto them, e.g. "near lake eola" → "Lake Eola Heights"): ${NEIGHBORHOODS.join("; ")}. Cities must come from this exact list: ${CITIES.join("; ")}. A city name is a city filter; neighborhood names take precedence when both could match (e.g. "downtown orlando" is the Downtown Orlando neighborhood, not also the city Orlando). Amenities must come from this exact list: ${AMENITIES.join("; ")}. Bedrooms: a plain count means EXACTLY that many — "2br"/"two bed" → beds_min 2 AND beds_max 2; "studio" → beds_min 0 AND beds_max 0; only an open-ended phrasing ("2+", "at least 2", "2 or more") sets beds_min 2 with beds_max null. sort expresses ORDERING, never a constraint: "cheapest"/"cheaper"/"lowest rent"/"most affordable" → sort "price_asc" with price_max null; "most expensive"/"priciest" → "price_desc"; "newest"/"just listed" → "newest"; "smallest"/"smaller" (unit size) → "sqft_asc"; "biggest"/"bigger"/"largest" → "sqft_desc"; anything else → "relevance". A sort word is consumed — never repeat it in residual_text. Put any leftover free text that expresses a real constraint you could not map into residual_text, else "".`;

// Spec §6.1 budgets 800ms; the demo uses a looser 2500ms so a cold Haiku
// round-trip lands as "llm" rather than falling open mid-demo.
const DEFAULT_TIMEOUT_MS = 2500;

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
  if (!client) return fallback();

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
    const parsed: ParsedQuery = {
      neighborhoods: out.neighborhoods,
      cities: out.cities,
      priceMax: out.price_max_dollars,
      bedsMin: out.beds_min,
      bedsMax: out.beds_max,
      furnished: out.furnished,
      shortTerm: out.short_term,
      amenities: out.amenities,
      sort: out.sort,
      residualText: out.residual_text,
      failedOpen: false,
      parseSource: "llm",
      parseMs: Math.round(performance.now() - started),
    };
    cache.set(key, parsed);
    return parsed;
  } catch {
    return fallback(); // timeout, network, refusal, anything → keyword rung
  } finally {
    if (timer) clearTimeout(timer); // never leave the race's timer live
  }
}

/** Production entrypoint: real client, default budget. */
export function parseQuery(raw: string): Promise<ParsedQuery> {
  return parseQueryWith(raw, getClient());
}
