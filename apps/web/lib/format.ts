const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatPrice(price: number | null): string {
  // Undisclosed prices are surfaced, never hidden.
  if (price === null) return "Price not listed";
  return usd.format(price);
}

export function formatBedsBaths(beds: number, baths: number): string {
  const bd = beds === 0 ? "Studio" : `${beds} bd`;
  return `${bd} · ${baths} ba`;
}

export function formatSqft(sqft: number | null): string | null {
  if (sqft === null) return null;
  return `${sqft.toLocaleString("en-US")} sqft`;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function relativeTime(at: string, now: Date): string {
  const age = now.getTime() - new Date(at).getTime();
  if (age < 5 * MIN) return "just now";
  if (age < HOUR) return `${Math.floor(age / MIN)}m ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h ago`;
  return `${Math.floor(age / DAY)}d ago`;
}

export function freshnessLabel(lastConfirmedAt: string, now: Date): string {
  const rel = relativeTime(lastConfirmedAt, now);
  return rel === "just now" ? "Confirmed just now" : `Confirmed ${rel}`;
}

export type FreshnessTier = "fresh" | "aging" | "stale";

// Freshness decay half-life is ~3 days; these tiers drive the indicator
// dot color only, not ranking.
export function freshnessTier(
  lastConfirmedAt: string,
  now: Date,
): FreshnessTier {
  const age = now.getTime() - new Date(lastConfirmedAt).getTime();
  if (age < DAY) return "fresh";
  if (age < 3 * DAY) return "aging";
  return "stale";
}
