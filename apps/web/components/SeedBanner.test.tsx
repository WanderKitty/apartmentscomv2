import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SeedBanner } from "./SeedBanner";

describe("SeedBanner", () => {
  it("reads as an honest seed-only line when there are no scraped listings", () => {
    render(<SeedBanner seed={26} scraped={0} />);
    expect(
      screen.getByText(
        "Corpus: 26 seeded demo listings (built to the v1_processed_unit_data schema; every number is arithmetic, not scraped fact).",
      ),
    ).toBeInTheDocument();
  });

  it("reads as a provenance line when there are only scraped listings (production: zero seed)", () => {
    render(<SeedBanner seed={0} scraped={40} />);
    expect(
      screen.getByText(
        "Corpus: 40 listings scraped from public property sites, refreshed on a schedule.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/seeded/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 seeded/)).not.toBeInTheDocument();
  });

  it("combines both clauses when seed and scraped listings both exist", () => {
    render(<SeedBanner seed={26} scraped={40} />);
    expect(
      screen.getByText(
        "Corpus: 26 seeded demo listings (built to the v1_processed_unit_data schema; every number is arithmetic, not scraped fact) + 40 listings scraped from public property sites, refreshed on a schedule.",
      ),
    ).toBeInTheDocument();
  });
});
