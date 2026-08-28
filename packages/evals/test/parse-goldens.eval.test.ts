import { describe, expect, it } from 'vitest'
import { __resetParseCacheForTests, parseQuery } from '@aptv2/search'
import { GOLDENS, scoreGoldens } from '../src/goldens'

const KEY = process.env.ANTHROPIC_API_KEY

describe.skipIf(!KEY)('golden parse regression (live claude-haiku-4-5)', () => {
  it('meets per-field accuracy thresholds over the 50-query golden set', async () => {
    __resetParseCacheForTests()
    let llmCount = 0
    const parsed = []
    for (const g of GOLDENS) {
      const p = await parseQuery(g.q)
      if (p.parseSource === 'llm') llmCount++
      parsed.push({ golden: g, parsed: p })
    }
    const { rates, misses } = scoreGoldens(parsed)
    const n = GOLDENS.length
    console.log(`llm-parsed: ${llmCount}/${n}`)
    console.log(misses.join('\n') || 'no field misses')
    expect(llmCount).toBeGreaterThan(n * 0.9) // the live rung must actually be exercised
    expect(rates.priceMax).toBeGreaterThanOrEqual(0.95)
    expect(rates.bedsMin).toBeGreaterThanOrEqual(0.95)
    expect(rates.bedsMax).toBeGreaterThanOrEqual(0.9)
    expect(rates.neighborhoods).toBeGreaterThanOrEqual(0.9)
    expect(rates.furnished).toBeGreaterThanOrEqual(0.9)
    expect(rates.shortTerm).toBeGreaterThanOrEqual(0.9)
    expect(rates.amenities).toBeGreaterThanOrEqual(0.85)
  })
})
