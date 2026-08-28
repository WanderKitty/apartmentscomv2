import { describe, expect, it } from "vitest";
import { parseQueryKeywords } from "./keyword-parse";

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
  // rebuildQuery) handles this via neighborhood-priority reconstruction —
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
