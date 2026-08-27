import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ListingCard } from "./ListingCard";
import { makeListings } from "@/lib/fixtures";

const NOW = new Date("2026-08-27T18:00:00Z");
const listings = makeListings(NOW);
const byId = (id: string) => {
  const l = listings.find((x) => x.id === id);
  if (!l) throw new Error(`fixture ${id} missing`);
  return l;
};

describe("ListingCard", () => {
  it("shows price, freshness stamp, and net-effective rent", () => {
    render(<ListingCard listing={byId("seed___u0001")} now={NOW} />);
    expect(screen.getByText("$1,895")).toBeInTheDocument();
    // The freshness stamp renders in both the mobile and desktop slots.
    expect(screen.getAllByText("Confirmed 6h ago").length).toBeGreaterThan(0);
    expect(screen.getByText(/\$1,693 net effective/)).toBeInTheDocument();
  });

  it("flags 'starting at' prices honestly", () => {
    render(<ListingCard listing={byId("seed___u0003")} now={NOW} />);
    expect(screen.getByText(/starting at/i)).toBeInTheDocument();
  });

  it("badges undisclosed prices instead of hiding the listing", () => {
    render(<ListingCard listing={byId("seed___u0004")} now={NOW} />);
    expect(screen.getByText("Price not listed")).toBeInTheDocument();
  });

  it("shows a price-drop signal when history has a drop", () => {
    render(<ListingCard listing={byId("seed___u0001")} now={NOW} />);
    expect(screen.getByText(/\$150 drop/)).toBeInTheDocument();
  });

  it("links to the listing detail page", () => {
    render(<ListingCard listing={byId("seed___u0001")} now={NOW} />);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/listing/seed___u0001",
    );
  });

  it("hides score components unless debug is on", () => {
    const { rerender } = render(
      <ListingCard listing={byId("seed___u0001")} now={NOW} />,
    );
    expect(screen.queryByText(/relevance/)).not.toBeInTheDocument();
    rerender(<ListingCard listing={byId("seed___u0001")} now={NOW} debug />);
    expect(screen.getByText(/relevance/)).toBeInTheDocument();
  });
});
