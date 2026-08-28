import type pg from 'pg'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import {
  ProcessedUnitDataSchema,
  SOURCE_ID_SEPARATOR,
  minimalUnit,
  netEffectiveMonthlyCents,
  type Concession,
  type ProcessedUnitData,
} from '@aptv2/schema'
import { parseEntrataPayload, sha256Json, type SourceRow } from '@aptv2/scrapers'

// Stage 3 (spec §5.3): deterministic mapping first — no LLM for price /
// beds / baths / sqft / availability — then one enrichment call per
// CHANGED unit for genuinely unstructured text, cached by content hash.
// Fail-open: no key / any error → enriched fields stay not_mentioned.

export type LlmEnrichment = {
  pets_allowed: ProcessedUnitData['pets_allowed']
  concession_text: string | null
  concession: Concession | null
  furnished: ProcessedUnitData['furnished'] | null
  short_term_ok: boolean | null
  summary: string | null
}
export type LlmEnricher = (texts: string[]) => Promise<LlmEnrichment | null>

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

export async function extractSnapshot(
  pool: pg.Pool,
  args: {
    snapshot: { id: number; source_id: number; payload: unknown }
    source: SourceRow
    now: Date
    llm?: LlmEnricher | null
  },
): Promise<{ units: ProcessedUnitData[]; failures: Array<{ externalId: string; error: string }> }> {
  const { snapshot, source, now } = args
  // baseUrl absolutizes any site-relative detail-page path the payload
  // carries (e.g. the embedded shape's permalink) — required so
  // `source_url` below is always a valid absolute URL for the schema.
  const parsed = parseEntrataPayload(snapshot.payload, source.endpoint_config.endpoint_url) // shape error here fails the whole snapshot — correct: nothing is trustworthy
  const prop = source.endpoint_config.property
  const nowIso = now.toISOString()
  const units: ProcessedUnitData[] = []
  const failures: Array<{ externalId: string; error: string }> = []

  for (const ru of parsed) {
    try {
      const externalId = `${slug(prop.name)}-${slug(ru.externalId)}`
      const texts = [...ru.amenityTexts, ...ru.marketingTexts]
      // Keyed on the enrichment INPUTS only (not the whole raw unit) so a
      // rent/availability change doesn't bust an LLM result that's still valid.
      const unitHash = sha256Json({ texts, v: 2 })
      const enrichment = await cachedEnrichment(pool, unitHash, args.llm ?? null, texts)
      const concession = enrichment?.concession ?? null
      // Deterministic (no LLM): a stated lower "special" rate is a fact,
      // not an interpretation — takes priority over any LLM-derived concession.
      const specialRate =
        ru.rentSpecialCents !== null && ru.rentCents !== null && ru.rentSpecialCents < ru.rentCents
          ? {
              cents: ru.rentSpecialCents,
              text: `Special rate $${Math.round(ru.rentSpecialCents / 100)}/mo (advertised $${Math.round(ru.rentCents / 100)}/mo)`,
            }
          : null
      const base = minimalUnit()
      const record: ProcessedUnitData = ProcessedUnitDataSchema.parse({
        ...base,
        source_id: `entrata${SOURCE_ID_SEPARATOR}${externalId}`,
        platform: 'entrata',
        collapse_key: `entrata:${externalId}`,
        liberal_dedup_cluster: `orlando:${slug(prop.address_line1)}-${slug(ru.unitNumber ?? ru.floorplanName ?? ru.externalId)}`,
        source_url: ru.detailUrl ?? source.website_url,
        data_provenance: 'scraped',
        scraped_at: nowIso,
        property_name: prop.name,
        address_line1: prop.address_line1,
        city: prop.city,
        state: prop.state,
        zip: prop.zip,
        neighborhood: '', // resolved spatially at upsert (Task 5 amendment)
        latitude: prop.latitude,
        longitude: prop.longitude,
        unit_number: ru.unitNumber,
        floorplan_name: ru.floorplanName,
        beds: ru.beds,
        baths: ru.baths,
        sqft: ru.sqft,
        is_sqft_not_mentioned: ru.sqft === null,
        advertised_rent_cents: ru.rentCents,
        is_rent_not_mentioned: ru.rentCents === null,
        price_level: ru.rentCents === null ? 'not_listed' : ru.unitNumber ? 'unit' : 'floorplan_starting_at',
        is_price_transparent: ru.rentCents !== null && ru.unitNumber !== null,
        ...(ru.rentCents !== null
          ? {
              rent_monthly_cents: ru.rentCents,
              rent_annual_cents: ru.rentCents * 12,
              rent_weekly_cents: Math.round((ru.rentCents * 12) / 52),
              rent_daily_cents: Math.round((ru.rentCents * 12) / 365),
            }
          : {}),
        concession_type: specialRate ? 'other' : concession ? concession.kind : enrichment ? 'none' : 'not_mentioned',
        concession_text_raw: specialRate?.text ?? enrichment?.concession_text ?? null,
        ...(specialRate
          ? { net_effective_monthly_cents: specialRate.cents }
          : concession && ru.rentCents !== null
            ? {
                net_effective_monthly_cents: netEffectiveMonthlyCents({
                  advertisedCents: ru.rentCents,
                  concession,
                }),
                concession_applies_lease_months: concession.leaseMonths,
                ...(concession.kind === 'free_weeks' ? { concession_free_weeks: concession.weeks } : {}),
                ...(concession.kind === 'free_months' ? { concession_free_months: concession.months } : {}),
                ...(concession.kind === 'flat_discount' ? { concession_value_cents: concession.valueCents } : {}),
              }
            : {}),
        pets_allowed: enrichment?.pets_allowed ?? 'not_mentioned',
        furnished: enrichment?.furnished ?? 'not_mentioned',
        short_term_ok: enrichment?.short_term_ok ?? null,
        generated_summary: enrichment?.summary ?? null,
        available_on: ru.availableOn,
        is_available_now: ru.availableOn !== null && ru.availableOn <= nowIso.slice(0, 10),
        first_seen_at: nowIso, // upsert keeps the earlier first_listed_at on conflict
        last_confirmed_at: nowIso,
        estimated_publish_date: nowIso.slice(0, 10),
        events: [
          { at: nowIso, kind: 'first_listed', from_cents: null, to_cents: ru.rentCents, note: null },
        ],
      })
      units.push(record)
    } catch (e) {
      failures.push({ externalId: ru.externalId, error: (e as Error).message }) // counted, never silent (spec §5)
    }
  }
  return { units, failures }
}

async function cachedEnrichment(
  pool: pg.Pool,
  hash: string,
  llm: LlmEnricher | null,
  texts: string[],
): Promise<LlmEnrichment | null> {
  const { rows } = await pool.query(`SELECT extracted FROM extract_cache WHERE content_hash = $1`, [hash])
  // A stored JSON `null` (from a prior "nothing to extract" result) is
  // still a row — this is a cache HIT returning null, not a miss.
  if (rows[0]) return rows[0].extracted as LlmEnrichment | null
  if (!llm || texts.every((t) => !t.trim())) return null
  try {
    const out = await llm(texts)
    // Cache the result whether or not it's null, so a known-nothing unit
    // isn't re-sent to the LLM on every run.
    await pool.query(
      `INSERT INTO extract_cache (content_hash, extracted) VALUES ($1, $2)
       ON CONFLICT (content_hash) DO NOTHING`,
      [hash, JSON.stringify(out ?? null)],
    )
    return out
  } catch {
    return null // fail-open by design: enrichment degrades, the listing still lands
  }
}

// ---------------------------------------------------------------------
// Haiku enrichment: mirrors packages/search/src/llm-parse.ts's structure
// (single client.messages.parse call, zodOutputFormat, fail-open).
// ---------------------------------------------------------------------

// Mirrors ProcessedUnitDataSchema's pets_allowed / furnished enums
// (those aren't exported as standalone const arrays from @aptv2/schema).
const PETS_ALLOWED = ['allowed', 'cats_only', 'dogs_only', 'not_allowed', 'not_mentioned'] as const
const FURNISHED = ['furnished', 'unfurnished', 'optional', 'not_mentioned'] as const

const ConcessionSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('free_weeks'), weeks: z.number(), leaseMonths: z.number() }),
    z.object({ kind: z.literal('free_months'), months: z.number(), leaseMonths: z.number() }),
    z.object({ kind: z.literal('flat_discount'), valueCents: z.number(), leaseMonths: z.number() }),
  ])
  .nullable()

const LlmEnrichmentSchema = z.object({
  pets_allowed: z.enum(PETS_ALLOWED),
  concession_text: z.string().nullable(),
  concession: ConcessionSchema,
  furnished: z.enum(FURNISHED).nullable(),
  short_term_ok: z.boolean().nullable(),
  summary: z.string().nullable(),
})

const SYSTEM =
  'Extract ONLY facts stated in these apartment listing texts; null for anything not stated. Never guess.'

const ENRICH_TIMEOUT_MS = 10_000

/** Returns null without ANTHROPIC_API_KEY (fail-open at construction, same as the caller's fail-open per call). */
export function createHaikuEnricher(): LlmEnricher | null {
  if (!process.env.ANTHROPIC_API_KEY) return null
  const client = new Anthropic()
  return async (texts: string[]): Promise<LlmEnrichment | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const response = await Promise.race([
        client.messages.parse({
          model: 'claude-haiku-4-5',
          max_tokens: 1024,
          system: SYSTEM,
          messages: [{ role: 'user', content: texts.join('\n') }],
          output_config: { format: zodOutputFormat(LlmEnrichmentSchema) },
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('enrich-timeout')), ENRICH_TIMEOUT_MS)
        }),
      ])
      return response.parsed_output ?? null
    } finally {
      if (timer) clearTimeout(timer) // never leave the race's timer live
    }
  }
}
