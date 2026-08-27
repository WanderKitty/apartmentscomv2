import { describe, expect, it } from "vitest";
import {
  formatPrice,
  formatBedsBaths,
  formatSqft,
  freshnessLabel,
  freshnessTier,
} from "./format";

const NOW = new Date("2026-08-27T18:00:00Z");
const iso = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatPrice", () => {
  it("formats whole dollars with a thousands separator", () => {
    expect(formatPrice(1950)).toBe("$1,950");
  });

  it("labels undisclosed prices instead of hiding them (spec §6.2)", () => {
    expect(formatPrice(null)).toBe("Price not listed");
  });
});

describe("formatBedsBaths", () => {
  it("renders studios by name, not '0 bd'", () => {
    expect(formatBedsBaths(0, 1)).toBe("Studio · 1 ba");
  });

  it("renders beds and baths counts", () => {
    expect(formatBedsBaths(2, 2)).toBe("2 bd · 2 ba");
  });

  it("keeps half baths", () => {
    expect(formatBedsBaths(3, 2.5)).toBe("3 bd · 2.5 ba");
  });
});

describe("formatSqft", () => {
  it("formats with separator and unit", () => {
    expect(formatSqft(1042)).toBe("1,042 sqft");
  });

  it("returns null when the source did not expose sqft", () => {
    expect(formatSqft(null)).toBeNull();
  });
});

describe("freshnessLabel", () => {
  it("says 'just now' under 5 minutes", () => {
    expect(freshnessLabel(iso(2 * MIN), NOW)).toBe("Confirmed just now");
  });

  it("uses minutes under an hour", () => {
    expect(freshnessLabel(iso(32 * MIN), NOW)).toBe("Confirmed 32m ago");
  });

  it("uses hours under a day", () => {
    expect(freshnessLabel(iso(6 * HOUR), NOW)).toBe("Confirmed 6h ago");
  });

  it("uses days from a day up", () => {
    expect(freshnessLabel(iso(3 * DAY + 2 * HOUR), NOW)).toBe(
      "Confirmed 3d ago",
    );
  });
});

describe("freshnessTier", () => {
  // Half-life of freshness decay is ~3 days (spec §5.5); tiers for the UI dot.
  it("is fresh under 24h", () => {
    expect(freshnessTier(iso(6 * HOUR), NOW)).toBe("fresh");
  });

  it("is aging between 24h and 72h", () => {
    expect(freshnessTier(iso(2 * DAY), NOW)).toBe("aging");
  });

  it("is stale past 72h", () => {
    expect(freshnessTier(iso(4 * DAY), NOW)).toBe("stale");
  });
});
