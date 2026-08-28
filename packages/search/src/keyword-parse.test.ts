import { describe, expect, it } from 'vitest'
import { parseQueryKeywords } from './keyword-parse'

describe('price', () => {
  it('parses "under $2,400" with comma', () => {
    expect(parseQueryKeywords('2br under $2,400').priceMax).toBe(2400)
  })
  it('multiplies a k suffix', () => {
    expect(parseQueryKeywords('1 bed under 2k').priceMax).toBe(2000)
  })
  it.each([
    ['below 1800', 1800],
    ['less than $1500', 1500],
    ['max 1700', 1700],
    ['<= 2100', 2100],
    ['< 2100', 2100],
  ])('parses "%s"', (q, expected) => {
    expect(parseQueryKeywords(q).priceMax).toBe(expected)
  })
  it('no price phrase → null', () => {
    expect(parseQueryKeywords('2 bedroom downtown').priceMax).toBeNull()
  })
})

describe('beds', () => {
  it('plain count is an exact match (user ruling)', () => {
    const p = parseQueryKeywords('2 bedroom')
    expect(p.bedsMin).toBe(2)
    expect(p.bedsMax).toBe(2)
  })
  it.each(['2+ br', '2+ bedrooms'])('"%s" leaves the upper bound open', (q) => {
    const p = parseQueryKeywords(q)
    expect(p.bedsMin).toBe(2)
    expect(p.bedsMax).toBeNull()
  })
  it.each(['at least 2 bed', '2 bedrooms or more', 'minimum 2 br'])(
    '"%s" leaves the upper bound open',
    (q) => {
      const p = parseQueryKeywords(q)
      expect(p.bedsMin).toBe(2)
      expect(p.bedsMax).toBeNull()
    },
  )
  it('studio → 0/0', () => {
    const p = parseQueryKeywords('studio in thornton park')
    expect(p.bedsMin).toBe(0)
    expect(p.bedsMax).toBe(0)
  })
  it('bare number without a bed word is not a bed count', () => {
    expect(parseQueryKeywords('mills 50').bedsMin).toBeNull()
  })
})

describe('furnished / short term', () => {
  it('unfurnished wins over the furnished substring', () => {
    expect(parseQueryKeywords('unfurnished 2 bedroom').furnished).toBe(false)
  })
  it('furnished → true, absent → null', () => {
    expect(parseQueryKeywords('furnished studio').furnished).toBe(true)
    expect(parseQueryKeywords('2 bedroom').furnished).toBeNull()
  })
  it.each(['short term', 'short-term', 'month to month', 'month-to-month'])(
    '"%s" → shortTerm',
    (q) => {
      expect(parseQueryKeywords(q).shortTerm).toBe(true)
    },
  )
})

describe('neighborhoods and amenities from the shared taxonomy', () => {
  it('resolves aliases', () => {
    expect(parseQueryKeywords('cbd studio').neighborhoods).toEqual(['Downtown Orlando'])
    expect(parseQueryKeywords('near lake eola').neighborhoods).toEqual(['Lake Eola Heights'])
  })
  it('maps amenity keywords to canonical names', () => {
    const p = parseQueryKeywords('dog friendly with washer dryer in unit and a gym')
    expect(p.amenities).toEqual(expect.arrayContaining(['pet friendly', 'in-unit laundry', 'gym']))
  })
})

describe('fail-open ladder (§6.1)', () => {
  it('nothing recognized → raw text becomes residual FTS input', () => {
    const p = parseQueryKeywords('sunny place with good vibes')
    expect(p.failedOpen).toBe(true)
    expect(p.residualText).toBe('sunny place with good vibes')
  })
  it('anything recognized → no fail-open, empty residual', () => {
    const p = parseQueryKeywords('2br downtown')
    expect(p.failedOpen).toBe(false)
    expect(p.residualText).toBe('')
  })
  it('empty query is not fail-open', () => {
    expect(parseQueryKeywords('  ').failedOpen).toBe(false)
  })
  it('always reports the fallback rung with zero latency', () => {
    const p = parseQueryKeywords('2br')
    expect(p.parseSource).toBe('fallback')
    expect(p.parseMs).toBe(0)
  })
})
