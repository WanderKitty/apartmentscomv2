import { describe, it, expect } from "vitest";
import { pinPositions } from "./map-pins";

const at = (id: string, lat: number | null, lng: number | null) => ({ id, lat, lng });

describe("pinPositions", () => {
  it("keeps unique coordinates exactly and drops listings without any", () => {
    const pins = pinPositions([
      at("a", 28.5462, -81.3708),
      at("b", 28.5379, -81.3545),
      at("c", null, null),
    ]);
    expect(pins).toEqual([
      { id: "a", lat: 28.5462, lng: -81.3708 },
      { id: "b", lat: 28.5379, lng: -81.3545 },
    ]);
  });

  it("spreads colliding coordinates apart, deterministically, staying within ~150m", () => {
    const input = [
      at("a", 28.5462, -81.3708),
      at("b", 28.5462, -81.3708),
      at("c", 28.5462, -81.3708),
    ];
    const pins = pinPositions(input);
    expect(pins).toHaveLength(3);
    // All pairwise distinct after spreading.
    const keys = pins.map((p) => `${p.lat},${p.lng}`);
    expect(new Set(keys).size).toBe(3);
    // Each stays close to the true coordinate (≤ 0.0015° ≈ 150m).
    for (const p of pins) {
      expect(Math.abs(p.lat - 28.5462)).toBeLessThanOrEqual(0.0015);
      expect(Math.abs(p.lng - -81.3708)).toBeLessThanOrEqual(0.0015);
    }
    // Deterministic: same input, same output.
    expect(pinPositions(input)).toEqual(pins);
  });
});
