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
  furnished: z.boolean().nullable(),
  short_term: z.boolean().nullable(),
  amenities: z.array(z.enum(AMENITIES)),
  residual_text: z.string(),
});

const SYSTEM = `You convert one apartment-search query into filters. Extract ONLY constraints the user actually stated; use null for anything not stated. Neighborhoods must come from this exact list (map colloquial names onto them, e.g. "near lake eola" → "Lake Eola Heights"): ${NEIGHBORHOODS.join("; ")}. Amenities must come from this exact list: ${AMENITIES.join("; ")}. "2br"/"two bed" → beds_min 2; "studio" → beds_min 0. Put any leftover free text that expresses a real constraint you could not map into residual_text, else "".`;

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
      priceMax: out.price_max_dollars,
      bedsMin: out.beds_min,
      furnished: out.furnished,
      shortTerm: out.short_term,
      amenities: out.amenities,
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
    if (timer) clearTimeout(timer); // A6: never leave the race's timer live
  }
}

/** Production entrypoint: real client, default budget. */
export function parseQuery(raw: string): Promise<ParsedQuery> {
  return parseQueryWith(raw, getClient());
}
