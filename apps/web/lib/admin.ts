import "server-only";
import type { getPool } from "@aptv2/db";
import type { SourceHealth } from "./types";

// apps/web has no direct dependency on `pg`; borrow its Pool type from
// @aptv2/db (which does) rather than adding one just for a type import.
type Pool = ReturnType<typeof getPool>;

// Admin/ops read model (spec §8) over sources + scrape_runs + listings.
// One query, LATERAL-joined per source: `al` counts this source's active
// listings; `latest`/`older` each pick one scrape_runs row per source
// (the newest run overall, and the newest run older than 24h) so
// listingDelta24h can compare "now" against "a day ago" without a GROUP BY
// that can't express "top 1 row per group under a filter".
const SOURCE_HEALTH_SQL = `
SELECT
  s.id, s.name, s.platform, s.enabled, s.last_scraped_at, s.failure_streak,
  COALESCE(al.n, 0)::int AS active_listings,
  latest.listings_found AS latest_found,
  older.listings_found AS older_found
FROM sources s
LEFT JOIN LATERAL (
  SELECT count(*)::int AS n FROM listings WHERE source_ref = s.id AND status = 'active'
) al ON true
LEFT JOIN LATERAL (
  -- 'failed' runs leave listings_found at its default 0 (never a real
  -- count), so they must be invisible to this metric or a failed-most-
  -- recently source would show a phantom negative delta. 'partial' runs
  -- DO carry a real listings_found (the worker writes units.length on
  -- both the clean and partial-failure branches).
  SELECT listings_found FROM scrape_runs
  WHERE source_id = s.id AND status IN ('ok', 'partial')
  ORDER BY started_at DESC LIMIT 1
) latest ON true
LEFT JOIN LATERAL (
  SELECT listings_found FROM scrape_runs
  WHERE source_id = s.id AND status IN ('ok', 'partial')
    AND started_at < now() - interval '24 hours'
  ORDER BY started_at DESC LIMIT 1
) older ON true
ORDER BY s.id
`;

type Row = {
  id: number;
  name: string;
  platform: string;
  enabled: boolean;
  last_scraped_at: Date | null;
  failure_streak: number;
  active_listings: number;
  latest_found: number | null;
  older_found: number | null;
};

export async function getSourceHealth(pool: Pool): Promise<SourceHealth[]> {
  const { rows } = await pool.query<Row>(SOURCE_HEALTH_SQL);
  return rows.map((r) => ({
    id: String(r.id),
    name: r.name,
    platform: r.platform,
    enabled: r.enabled,
    lastScrapedAt: r.last_scraped_at ? r.last_scraped_at.toISOString() : null,
    failureStreak: r.failure_streak,
    activeListings: r.active_listings,
    // 0 when unknown: either no runs at all, or no run older than 24h to compare against.
    listingDelta24h:
      r.latest_found === null || r.older_found === null
        ? 0
        : r.latest_found - r.older_found,
  }));
}
