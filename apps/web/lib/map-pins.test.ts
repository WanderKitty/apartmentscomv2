import { describe, it, expect } from "vitest";
import { groupPins } from "./map-pins";

const at = (id: string, lat: number | null, lng: number | null) => ({ id, lat, lng });

describe("groupPins", () => {
  it("keeps distinct coordinates as separate single-listing pins and drops unlocated listings", () => {
    const groups = groupPins([
      at("a", 28.5462, -81.3708),
      at("b", 28.5379, -81.3545),
      at("c", null, null),
    ]);
    expect(groups).toEqual([
      { lat: 28.5462, lng: -81.3708, ids: ["a"] },
      { lat: 28.5379, lng: -81.3545, ids: ["b"] },
    ]);
  });

  it("collapses all listings at one coordinate into a single pin, never moving it", () => {
    // A scraped property lists every unit at the building's coordinate —
    // 100 units must be ONE pin at the exact spot, not a ring of 100.
    const many = Array.from({ length: 100 }, (_, i) => at(`u${i}`, 28.5462, -81.3708));
    const groups = groupPins([...many, at("solo", 28.55, -81.36)]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ lat: 28.5462, lng: -81.3708 });
    expect(groups[0]!.ids).toHaveLength(100);
    expect(groups[1]!.ids).toEqual(["solo"]);
  });

  it("preserves ranking order: groups by first appearance, ids in input order", () => {
    const groups = groupPins([
      at("first", 28.5, -81.3),
      at("second", 28.6, -81.4),
      at("third", 28.5, -81.3),
    ]);
    expect(groups.map((g) => g.ids)).toEqual([["first", "third"], ["second"]]);
  });
});
