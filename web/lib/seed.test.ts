import { describe, expect, it } from "vitest";
import { ProcessedUnitDataSchema } from "./schema/processed-unit-data";
import { buildSeedUnits, toListing } from "./seed";

const NOW = new Date("2026-08-27T12:00:00.000Z");

describe("seed data", () => {
  const units = buildSeedUnits(NOW);

  it("has 26 schema-valid, seed-labeled units with unique ids", () => {
    expect(units).toHaveLength(26);
    for (const u of units) {
      ProcessedUnitDataSchema.parse(u);
      expect(u.data_provenance).toBe("seed");
    }
    expect(new Set(units.map((u) => u.source_id)).size).toBe(units.length);
  });

  it("contains exactly one multi-source dedup cluster, of size 2", () => {
    const byCluster = new Map<string, number>();
    for (const u of units) {
      byCluster.set(u.liberal_dedup_cluster, (byCluster.get(u.liberal_dedup_cluster) ?? 0) + 1);
    }
    const multi = [...byCluster.values()].filter((c) => c > 1);
    expect(multi).toEqual([2]);
  });

  it("has at least 4 units with concession math and correct arithmetic", () => {
    const withConcessions = units.filter(
      (u) => u.concession_type === "free_weeks" || u.concession_type === "free_months" || u.concession_type === "flat_discount",
    );
    expect(withConcessions.length).toBeGreaterThanOrEqual(4);
    for (const u of withConcessions) {
      expect(u.net_effective_monthly_cents).not.toBeNull();
      expect(u.net_effective_monthly_cents!).toBeLessThan(u.advertised_rent_cents!);
    }
  });

  it("has at least 3 units with multi-event price history", () => {
    const withHistory = units.filter(
      (u) => u.events.filter((e) => e.kind === "price_drop" || e.kind === "price_increase").length >= 1 && u.events.length >= 3,
    );
    expect(withHistory.length).toBeGreaterThanOrEqual(3);
  });

  it("projects to the UI Listing type with true-cost and days on market", () => {
    const camellia = units.find((u) => u.property_name.includes("Camellia"))!;
    const l = toListing(camellia, NOW);
    expect(l.provenance).toBe("seed");
    expect(l.trueCost!.netEffectiveMonthly).toBe(Math.round(camellia.net_effective_monthly_cents! / 100));
    expect(l.daysOnMarket).toBeGreaterThan(40); // first_listed 47 days before NOW
    expect(l.events.length).toBeGreaterThanOrEqual(3);
  });

  it("frequency normalization is consistent", () => {
    for (const u of units) {
      if (u.rent_monthly_cents !== null) {
        expect(u.rent_annual_cents).toBe(u.rent_monthly_cents * 12);
        expect(u.rent_weekly_cents).toBe(Math.round((u.rent_monthly_cents * 12) / 52));
      }
    }
  });
});
