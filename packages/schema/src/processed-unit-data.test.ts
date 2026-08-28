import { describe, expect, it } from "vitest";
import {
  ProcessedUnitDataSchema,
  SOURCE_ID_SEPARATOR,
  minimalUnit,
} from "./processed-unit-data";

describe("ProcessedUnitDataSchema", () => {
  it("accepts a minimal valid record with not_mentioned defaults", () => {
    const parsed = ProcessedUnitDataSchema.parse(minimalUnit());
    expect(parsed.is_year_built_not_mentioned).toBe(true);
    expect(parsed.pets_allowed).toBe("not_mentioned");
    expect(parsed.data_provenance).toBe("seed");
  });

  it("rejects an out-of-enum amenity", () => {
    const bad = { ...minimalUnit(), unit_amenities: ["helipad"] };
    expect(() => ProcessedUnitDataSchema.parse(bad)).toThrow();
  });

  it("rejects a source_id without the platform___external separator", () => {
    const bad = { ...minimalUnit(), source_id: "rentcafe-abc" };
    expect(() => ProcessedUnitDataSchema.parse(bad)).toThrow();
  });

  it("carries an optional floorplan/unit image_url, defaulting to null", () => {
    expect(ProcessedUnitDataSchema.parse(minimalUnit()).image_url).toBeNull();
    const withImage = {
      ...minimalUnit(),
      image_url: "https://example.com/floorplan.jpg",
    };
    expect(ProcessedUnitDataSchema.parse(withImage).image_url).toBe(
      "https://example.com/floorplan.jpg",
    );
    const bad = { ...minimalUnit(), image_url: "not-a-url" };
    expect(() => ProcessedUnitDataSchema.parse(bad)).toThrow();
  });

  it("field count is ~90 (93 as authored)", () => {
    const n = Object.keys(ProcessedUnitDataSchema.shape).length;
    expect(n).toBeGreaterThanOrEqual(60);
    // Sanity rail, not a target — never trim real fields to fit it.
    expect(n).toBeLessThanOrEqual(95);
  });

  it("exposes the source-id separator homage", () => {
    expect(SOURCE_ID_SEPARATOR).toBe("___");
  });
});
