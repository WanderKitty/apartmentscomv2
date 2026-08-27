import { describe, expect, it } from "vitest";
import { netEffectiveMonthlyCents } from "./net-effective";

describe("netEffectiveMonthlyCents", () => {
  it("spreads free weeks over the lease (6 wk free, $1,895, 13 mo)", () => {
    expect(
      netEffectiveMonthlyCents({
        advertisedCents: 189500,
        concession: { kind: "free_weeks", weeks: 6, leaseMonths: 13 },
      }),
    ).toBe(169317); // 189500 * (1 - (6*12/52)/13)
  });

  it("spreads one month free over 12 months", () => {
    expect(
      netEffectiveMonthlyCents({
        advertisedCents: 200000,
        concession: { kind: "free_months", months: 1, leaseMonths: 12 },
      }),
    ).toBe(183333);
  });

  it("spreads a flat discount over the lease", () => {
    expect(
      netEffectiveMonthlyCents({
        advertisedCents: 189500,
        concession: { kind: "flat_discount", valueCents: 100000, leaseMonths: 12 },
      }),
    ).toBe(181167);
  });

  it("no concession → advertised rent", () => {
    expect(
      netEffectiveMonthlyCents({ advertisedCents: 189500, concession: null }),
    ).toBe(189500);
  });
});
