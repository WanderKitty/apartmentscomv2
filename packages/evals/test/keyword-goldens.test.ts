import { describe, expect, it } from 'vitest'
import { parseQueryKeywords } from '@aptv2/search'
import { GOLDENS, scoreGoldens } from '../src/goldens'

describe('golden parse floor for the keyword fallback rung', () => {
  it('meets per-field accuracy floors over the 50-query golden set', () => {
    const { rates, misses } = scoreGoldens(
      GOLDENS.map((golden) => ({ golden, parsed: parseQueryKeywords(golden.q) })),
    )
    console.log(misses.join('\n') || 'no field misses')
    expect(rates.neighborhoods).toBeGreaterThanOrEqual(0.95)
    expect(rates.priceMax).toBeGreaterThanOrEqual(0.9)
    expect(rates.bedsMin).toBeGreaterThanOrEqual(0.85)
    expect(rates.bedsMax).toBeGreaterThanOrEqual(0.85)
    expect(rates.furnished).toBeGreaterThanOrEqual(0.95)
    expect(rates.shortTerm).toBeGreaterThanOrEqual(0.95)
    expect(rates.amenities).toBeGreaterThanOrEqual(0.9)
  })
})
