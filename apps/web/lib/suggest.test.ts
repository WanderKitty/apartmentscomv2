import { describe, expect, it } from "vitest";
import { buildSuggestions } from "./suggest";

describe("buildSuggestions", () => {
  it("suggests example queries when the input is empty", () => {
    const s = buildSuggestions("");
    expect(s.length).toBeGreaterThan(0);
    expect(s.every((x) => x.kind === "example")).toBe(true);
  });

  it("completes a bed-count filter from a prefix", () => {
    const s = buildSuggestions("2 b");
    expect(s[0]).toMatchObject({ label: "2 bed", kind: "filter", apply: "2 bed" });
  });

  it("completes only the trailing fragment, keeping the typed query", () => {
    const s = buildSuggestions("furnished 2 b");
    expect(s[0]!.apply).toBe("furnished 2 bed");
  });

  it("completes a price cap", () => {
    const s = buildSuggestions("2 bed under $2");
    expect(s.some((x) => x.apply === "2 bed under $2,000")).toBe(true);
  });

  it("completes Downtown Orlando — the one neighborhood with live inventory", () => {
    const s = buildSuggestions("2 bed downt");
    expect(s[0]).toMatchObject({ label: "downtown", kind: "neighborhood" });
    expect(s[0]!.apply).toBe("2 bed downtown");
  });

  it("still offers no inventory-less neighborhoods or amenities", () => {
    expect(buildSuggestions("bald")).toEqual([]);
    expect(buildSuggestions("1br with poo")).toEqual([]);
  });

  it("returns nothing for an unmatched fragment", () => {
    expect(buildSuggestions("zzzqqq")).toEqual([]);
  });

  it("never suggests what is already fully typed", () => {
    const s = buildSuggestions("furnished");
    expect(s.find((x) => x.apply === "furnished")).toBeUndefined();
  });

  it("caps the list", () => {
    expect(buildSuggestions("").length).toBeLessThanOrEqual(6);
  });
});
