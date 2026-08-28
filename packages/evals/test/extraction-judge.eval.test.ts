import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { describe, expect, it } from 'vitest'
import { parseEntrataPayload } from '@aptv2/scrapers'
import { createHaikuEnricher } from '@aptv2/pipeline'

const KEY = process.env.ANTHROPIC_API_KEY

const Verdict = z.object({
  fields: z.array(
    z.object({
      field: z.string(),
      verdict: z.enum(['supported', 'not_in_text', 'contradicted']),
      note: z.string(),
    }),
  ),
})

type TextedUnit = { amenityTexts: string[]; marketingTexts: string[] }
const hasTexts = (u: TextedUnit) => [...u.amenityTexts, ...u.marketingTexts].some((t) => t.trim())

/** Many units share identical marketing copy; judging duplicates wastes the sample budget. */
function uniqueByTexts<T extends TextedUnit>(units: T[]): T[] {
  const seen = new Set<string>()
  return units.filter((u) => {
    const key = [...u.amenityTexts, ...u.marketingTexts].join('\n')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

describe.skipIf(!KEY)('extraction sampling judged by claude-sonnet-5', () => {
  it('no extracted field contradicts its source text', async () => {
    const restPayload = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../scrapers/fixtures/entrata-availability.json', import.meta.url)),
        'utf8',
      ),
    )
    // Both captured payload shapes are judged: the REST feed and the
    // embedded floor-plans JSON (same extraction as entrataAdapter.fetch).
    const embeddedHtml = readFileSync(
      fileURLToPath(new URL('../../scrapers/fixtures/entrata-embedded.html', import.meta.url)),
      'utf8',
    )
    const embeddedMatch = embeddedHtml.match(/<script[^>]*id="jd-fp-data-script-app"[^>]*>([\s\S]*?)<\/script>/)
    if (!embeddedMatch) throw new Error('embedded floor-plan script tag not found in fixture')
    const embeddedPayload = JSON.parse(embeddedMatch[1]!)
    const restUnits = uniqueByTexts(parseEntrataPayload(restPayload).filter(hasTexts)).slice(0, 8)
    const embeddedUnits = uniqueByTexts(parseEntrataPayload(embeddedPayload).filter(hasTexts)).slice(0, 8)
    // Sample floor per shape; raise the caps as the corpus grows.
    expect(restUnits.length).toBeGreaterThanOrEqual(3)
    expect(embeddedUnits.length).toBeGreaterThanOrEqual(1)
    const units = [...restUnits, ...embeddedUnits]
    const enrich = createHaikuEnricher()!
    const judgeClient = new Anthropic()
    const contradictions: string[] = []
    for (const u of units) {
      const texts = [...u.amenityTexts, ...u.marketingTexts]
      const enrichment = await enrich(texts)
      if (!enrichment) continue // model found nothing to extract — nothing to judge
      const res = await judgeClient.messages.parse({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        system:
          'You verify data extraction. For each extracted field, judge strictly against ONLY the source texts: supported (text states it), not_in_text (a non-null extracted value the text does not state), or contradicted (a NON-NULL extracted value the text disputes). A null, not_mentioned, or omitted extracted value is NEVER a contradiction — extraction is required to be conservative, and declining to extract is always permitted.',
        messages: [
          {
            role: 'user',
            content: `SOURCE TEXTS:\n${texts.join('\n')}\n\nEXTRACTED:\n${JSON.stringify(enrichment, null, 2)}`,
          },
        ],
        output_config: { format: zodOutputFormat(Verdict) },
      })
      for (const f of res.parsed_output?.fields ?? []) {
        if (f.verdict === 'contradicted') contradictions.push(`${u.externalId}.${f.field}: ${f.note}`)
      }
    }
    console.log(contradictions.join('\n') || 'no contradictions')
    expect(contradictions).toEqual([])
  })
})
