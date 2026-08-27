import { describe, expect, it, vi } from "vitest";

vi.mock("./parse/llm-parse", async () => {
  const { parseQueryMock } = await import("./mock-search");
  return { parseQuery: vi.fn(async (raw: string) => parseQueryMock(raw)) };
});

import { searchService, matches } from "./search";
import { buildSeedUnits, toListing } from "@aptv2/schema";
import { parseQuery } from "./parse/llm-parse";
import type { ParsedQuery } from "./types";

const NO_FILTERS: ParsedQuery = {
  neighborhoods: [],
  priceMax: null,
  bedsMin: null,
  furnished: null,
  shortTerm: null,
  amenities: [],
  residualText: "",
  failedOpen: false,
  parseSource: "fallback",
  parseMs: 0,
};

describe("searchService", () => {
  it("the demo query returns only matching listings, best first", async () => {
    const r = await searchService.search("pet friendly 2br under $2400 near Lake Eola with in-unit laundry");
    expect(r.listings.length).toBeGreaterThanOrEqual(1);
    for (const l of r.listings.filter((x) => x.price !== null)) {
      expect(l.price!).toBeLessThanOrEqual(2400);
      expect(l.beds).toBeGreaterThanOrEqual(2);
      expect(l.neighborhood).toBe("Lake Eola Heights");
    }
    expect(r.listings[0].propertyName).toBe("Eola Commons");
  });

  it("price-undisclosed listings rank last, never dropped by a price filter", async () => {
    const r = await searchService.search("3 bed under $3000");
    const prices = r.listings.map((l) => l.price);
    if (prices.includes(null)) {
      expect(prices[prices.length - 1]).toBeNull();
    }
  });

  it("orders priced results by descending score, null-price listings strictly after (A7)", async () => {
    const r = await searchService.search("2 bed");
    const firstNull = r.listings.findIndex((l) => l.price === null);
    const priced = firstNull === -1 ? r.listings : r.listings.slice(0, firstNull);
    const scores = priced.map((l) => l.score.total);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    if (firstNull !== -1) {
      expect(r.listings.slice(firstNull).every((l) => l.price === null)).toBe(true);
    }
  });

  it("collapses the cross-platform duplicate into one card with alsoListedOn (B1)", async () => {
    const r = await searchService.search("1 bed");
    const cards = r.listings.filter((l) => l.propertyName === "Ridgewood House");
    expect(cards).toHaveLength(1);
    expect(cards[0].price).toBe(1775); // cheapest advertised price is primary
    expect(cards[0].alsoListedOn).toEqual([{ platform: "rentcafe", price: 1845 }]);
  });

  it("shortTerm: false is a hard filter, not a no-op — no returned listing is shortTermOk (regression)", async () => {
    vi.mocked(parseQuery).mockResolvedValueOnce({ ...NO_FILTERS, shortTerm: false });
    const r = await searchService.search("no month-to-month");
    expect(r.listings.length).toBeGreaterThan(0);
    expect(r.listings.every((l) => l.shortTermOk === false)).toBe(true);
  });

  it("matches() rejects a shortTermOk listing when shortTerm: false is requested (regression, unit-level)", () => {
    // The seed corpus has no shortTermOk: true listing, so the search-level
    // test above can't by itself distinguish the fix from the prior bug
    // (`p.shortTerm === true && !l.shortTermOk`, a no-op for shortTerm: false).
    // This exercises matches() directly against a synthetic positive case.
    const now = new Date();
    const base = toListing(buildSeedUnits(now)[0], now);
    const query: ParsedQuery = { ...NO_FILTERS, shortTerm: false };
    expect(matches({ ...base, shortTermOk: true }, query)).toBe(false);
    expect(matches({ ...base, shortTermOk: false }, query)).toBe(true);
  });

  it("reports timing with the seeded corpus size", async () => {
    const r = await searchService.search("studio");
    expect(r.timing.corpus).toBe(buildSeedUnits(new Date()).length);
    expect(r.timing.searchMs).toBeGreaterThanOrEqual(0);
    expect(r.timing.p50SearchMs).toBeGreaterThanOrEqual(0);
  });
});
