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
    // One freshness stamp, floating on the photo plate.
    expect(screen.getAllByText("Confirmed 6h ago")).toHaveLength(1);
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
    expect(screen.getByText("↓$150 on Aug 21")).toBeInTheDocument();
  });

  it("links to the listing detail page", () => {
    render(<ListingCard listing={byId("seed___u0001")} now={NOW} />);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/listing/seed___u0001",
    );
  });

  it("renders the listing photo when photoUrl is set, placeholder otherwise", () => {
    const withPhoto = {
      ...byId("seed___u0001"),
      photoUrl: "https://example.com/floorplans/a1.jpg",
    };
    const { rerender } = render(<ListingCard listing={withPhoto} now={NOW} />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://example.com/floorplans/a1.jpg");

    rerender(<ListingCard listing={byId("seed___u0001")} now={NOW} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows exactly one New tag for a day-0 listing (photo tag, no meta chip)", () => {
    const listing = { ...byId("seed___u0001"), daysOnMarket: 0 };
    render(<ListingCard listing={listing} now={NOW} />);
    expect(screen.getAllByText("New")).toHaveLength(1);
  });

  it("falls back to the city in the meta line when neighborhood is empty, no dangling separator", () => {
    const camellia = byId("seed___u0001");
    const listing = { ...camellia, neighborhood: "", city: "Tampa" };
    render(<ListingCard listing={listing} now={NOW} />);
    expect(screen.getByText(/^Tampa · /)).toBeInTheDocument();
  });

  it("keeps showing the neighborhood in the meta line when it is non-empty", () => {
    const camellia = byId("seed___u0001");
    render(<ListingCard listing={camellia} now={NOW} />);
    expect(screen.getByText(/^Lake Eola Heights · /)).toBeInTheDocument();
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
