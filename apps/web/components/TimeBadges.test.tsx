import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimeBadges } from "./TimeBadges";
import type { ListingEvent } from "@/lib/types";

const NOW = new Date("2026-08-27T12:00:00.000Z");
const events: ListingEvent[] = [
  { at: "2026-07-11T12:00:00.000Z", kind: "first_listed", fromCents: null, toCents: 204500, note: null },
  { at: "2026-08-21T12:00:00.000Z", kind: "price_drop", fromCents: 204500, toCents: 189500, note: null },
  { at: "2026-08-24T12:00:00.000Z", kind: "concession_added", fromCents: null, toCents: null, note: "6 weeks free" },
];

describe("TimeBadges", () => {
  it("renders drop amount with date, days on market, and concession recency", () => {
    render(<TimeBadges events={events} daysOnMarket={47} now={NOW} />);
    expect(screen.getByText("↓$150 on Aug 21")).toBeInTheDocument();
    expect(screen.getByText("47 days on market")).toBeInTheDocument();
    expect(screen.getByText("concession added this week")).toBeInTheDocument();
  });

  it("shows a New badge instead of '0 days on market'", () => {
    render(<TimeBadges events={[]} daysOnMarket={0} now={NOW} />);
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.queryByText(/days on market/)).not.toBeInTheDocument();
  });

  it("singularizes one day on market", () => {
    render(<TimeBadges events={[]} daysOnMarket={1} now={NOW} />);
    expect(screen.getByText("1 day on market")).toBeInTheDocument();
  });
});
