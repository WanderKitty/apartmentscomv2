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
  it('no price phrase â†’ null', () => {
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
  it('studio â†’ 0/0', () => {
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
  it('furnished â†’ true, absent â†’ null', () => {
    expect(parseQueryKeywords('furnished studio').furnished).toBe(true)
    expect(parseQueryKeywords('2 bedroom').furnished).toBeNull()
  })
  it.each(['short term', 'short-term', 'month to month', 'month-to-month'])(
    '"%s" â†’ shortTerm',
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

describe('fail-open ladder (Â§6.1)', () => {
  it('nothing recognized â†’ raw text becomes residual FTS input', () => {
    const p = parseQueryKeywords('sunny place with good vibes')
    expect(p.failedOpen).toBe(true)
    expect(p.residualText).toBe('sunny place with good vibes')
  })
  it('anything recognized â†’ no fail-open, empty residual', () => {
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

describe("parseQueryKeywords city extraction", () => {
  it("extracts a city as a city filter, not a neighborhood", () => {
    const p = parseQueryKeywords("2br in tampa");
    expect(p.cities).toEqual(["Tampa"]);
    expect(p.neighborhoods).toEqual([]);
  });

  it("prefers the neighborhood alias over a city name it contains (precedence)", () => {
    const p = parseQueryKeywords("downtown orlando");
    expect(p.neighborhoods).toEqual(["Downtown Orlando"]);
    expect(p.cities).toEqual([]);
  });

  // Pinned emergent behavior (reviewer-traced, accepted as-is): the
  // neighborhood alias "lake eola" only masks itself, not the trailing
  // "orlando" outside its span, so a query naming both a neighborhood AND
  // (separately) a city populates both arrays. Downstream (activeDrops /
  // rebuildQuery) handles this via neighborhood-priority reconstruction â€”
  // see postgres-search.test.ts.
  it("populates BOTH neighborhoods and cities when a city name sits outside the masked alias span", () => {
    const p = parseQueryKeywords("lake eola orlando");
    expect(p.neighborhoods).toEqual(["Lake Eola Heights"]);
    expect(p.cities).toEqual(["Orlando"]);
  });

  it("matches a punctuated multi-word city ('St. Petersburg')", () => {
    const p = parseQueryKeywords("1br in st. petersburg");
    expect(p.cities).toEqual(["St. Petersburg"]);
  });

  it("matches a two-word city ('Fort Lauderdale')", () => {
    const p = parseQueryKeywords("fort lauderdale 2 bed");
    expect(p.cities).toEqual(["Fort Lauderdale"]);
  });
});

describe("parseQueryKeywords amenity word-boundary matching", () => {
  it("does not false-positive 'washer' inside 'dishwasher'", () => {
    const p = parseQueryKeywords("dishwasher 2br");
    expect(p.amenities).not.toContain("in-unit laundry");
  });

  it("still matches a standalone 'washer' mention", () => {
    const p = parseQueryKeywords("washer and dryer");
    expect(p.amenities).toContain("in-unit laundry");
  });
});

describe("parseQueryKeywords sort intent", () => {
  it("'cheapest' alone is an ordering â€” consumed, never residual FTS", () => {
    const p = parseQueryKeywords("cheapest");
    expect(p.sort).toBe("price_asc");
    expect(p.priceMax).toBeNull();
    expect(p.residualText).toBe("");
    expect(p.failedOpen).toBe(false);
  });

  it("combines with filters: 'cheapest 2br in tampa'", () => {
    const p = parseQueryKeywords("cheapest 2br in tampa");
    expect(p.sort).toBe("price_asc");
    expect(p.bedsMin).toBe(2);
    expect(p.cities).toEqual(["Tampa"]);
  });

  it("maps expensive/newest/smallest/biggest phrasings", () => {
    expect(parseQueryKeywords("most expensive").sort).toBe("price_desc");
    expect(parseQueryKeywords("newest listings").sort).toBe("newest");
    expect(parseQueryKeywords("smallest 1br").sort).toBe("sqft_asc");
    expect(parseQueryKeywords("biggest 2 bedroom").sort).toBe("sqft_desc");
  });

  it("defaults to relevance when no ordering word appears", () => {
    expect(parseQueryKeywords("2br with pool").sort).toBe("relevance");
  });
});
