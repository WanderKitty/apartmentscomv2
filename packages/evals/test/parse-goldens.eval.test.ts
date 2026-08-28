import { describe, expect, it } from 'vitest'
import { __resetParseCacheForTests, parseQuery } from '@aptv2/search'
import { GOLDENS } from '../src/goldens'

const KEY = process.env.ANTHROPIC_API_KEY

describe.skipIf(!KEY)('golden parse regression (live claude-haiku-4-5)', () => {
  it('meets per-field accuracy thresholds over the 50-query golden set', async () => {
    __resetParseCacheForTests()
    const fields = ['neighborhoods', 'priceMax', 'bedsMin', 'bedsMax', 'furnished', 'shortTerm', 'amenities'] as const
    const hits: Record<string, number> = Object.fromEntries(fields.map((f) => [f, 0]))
    const misses: string[] = []
    let llmCount = 0
    for (const g of GOLDENS) {
      const p = await parseQuery(g.q)
      if (p.parseSource === 'llm') llmCount++
      const exp: Record<string, unknown> = {
        neighborhoods: [...(g.expect.neighborhoods ?? [])].sort(),
        priceMax: g.expect.priceMax ?? null,
        bedsMin: g.expect.bedsMin ?? null,
        bedsMax: g.expect.bedsMax ?? null,
        furnished: g.expect.furnished ?? null,
        shortTerm: g.expect.shortTerm ?? null,
        amenities: [...(g.expect.amenities ?? [])].sort(),
      }
      const got: Record<string, unknown> = {
        neighborhoods: [...p.neighborhoods].sort(),
        priceMax: p.priceMax,
        bedsMin: p.bedsMin,
        bedsMax: p.bedsMax,
        furnished: p.furnished,
        shortTerm: p.shortTerm,
        amenities: [...p.amenities].sort(),
      }
      for (const f of fields) {
        if (JSON.stringify(got[f]) === JSON.stringify(exp[f])) hits[f]!++
        else misses.push(`${f} | "${g.q}" | expected ${JSON.stringify(exp[f])} got ${JSON.stringify(got[f])}`)
      }
    }
    const n = GOLDENS.length
    console.log(`llm-parsed: ${llmCount}/${n}`)
    console.log(misses.join('\n') || 'no field misses')
    expect(llmCount).toBeGreaterThan(n * 0.9) // the live rung must actually be exercised
    expect(hits.priceMax! / n).toBeGreaterThanOrEqual(0.95)
    expect(hits.bedsMin! / n).toBeGreaterThanOrEqual(0.95)
    expect(hits.bedsMax! / n).toBeGreaterThanOrEqual(0.9)
    expect(hits.neighborhoods! / n).toBeGreaterThanOrEqual(0.9)
    expect(hits.furnished! / n).toBeGreaterThanOrEqual(0.9)
    expect(hits.shortTerm! / n).toBeGreaterThanOrEqual(0.9)
    expect(hits.amenities! / n).toBeGreaterThanOrEqual(0.85)
  })
})
