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
});
