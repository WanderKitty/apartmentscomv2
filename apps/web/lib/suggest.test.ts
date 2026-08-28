import { describe, expect, it } from "vitest";
import { buildSuggestions } from "./suggest";

describe("buildSuggestions", () => {
  it("suggests example queries when the input is empty", () => {
    const s = buildSuggestions("");
    expect(s.length).toBeGreaterThan(0);
    expect(s.every((x) => x.kind === "example")).toBe(true);
  });

  it("completes a neighborhood from a prefix", () => {
    const s = buildSuggestions("bald");
    expect(s[0]).toMatchObject({
      label: "Baldwin Park",
      kind: "neighborhood",
      apply: "Baldwin Park",
    });
  });

  it("completes only the trailing fragment, keeping the typed query", () => {
    const s = buildSuggestions("2 bed in bald");
    expect(s[0]!.apply).toBe("2 bed in Baldwin Park");
  });

  it("resolves aliases to the canonical neighborhood", () => {
    const s = buildSuggestions("near eola");
    const eola = s.find((x) => x.label === "Lake Eola Heights")!;
    expect(eola.apply).toBe("near Lake Eola Heights");
  });

  it("suggests amenities", () => {
    const s = buildSuggestions("1br with poo");
    expect(s[0]).toMatchObject({ label: "pool", kind: "amenity" });
    expect(s[0]!.apply).toBe("1br with pool");
  });

  it("does not complete bare connective words like 'in'", () => {
    // "2 bed in" must not offer "2 bed in-unit laundry".
    const s = buildSuggestions("2 bed in");
    expect(s.find((x) => x.label === "in-unit laundry")).toBeUndefined();
    // …but an explicit fragment still matches.
    expect(buildSuggestions("2 bed in-u")[0]!.label).toBe("in-unit laundry");
  });

  it("returns nothing for an unmatched fragment", () => {
    expect(buildSuggestions("zzzqqq")).toEqual([]);
  });

  it("never suggests what is already fully typed", () => {
    const s = buildSuggestions("Baldwin Park");
    expect(s.find((x) => x.apply === "Baldwin Park")).toBeUndefined();
  });

  it("caps the list", () => {
    expect(buildSuggestions("").length).toBeLessThanOrEqual(6);
  });
});
