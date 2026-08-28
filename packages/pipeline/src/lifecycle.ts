import type pg from 'pg'

// Confirm/stale/gone ladder. A scrape that finds a listing again
// (hash-unchanged short-circuit included) confirms it's still live; a
// listing that stops appearing in a source's payload gets one cycle of
// grace (active → stale) before being marked gone.

/** Hash short-circuit path: confirms every non-gone listing of a source is still live. */
export async function bumpConfirmed(pool: pg.Pool, sourceRef: number, at: Date): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE listings SET last_confirmed_at = $2 WHERE source_ref = $1 AND status <> 'gone'`,
    [sourceRef, at],
  )
  return rowCount ?? 0
}

/**
 * One-cycle grace: listings of this source not present in the current
 * scrape's collapse keys go active → stale, then stale → gone on
 * the NEXT cycle they're still missing. The gone-promotion runs first so a
 * listing that just went stale THIS call isn't also swept to gone in the
 * same invocation. Listings that reappear come back to active via the
 * upsert's own status write, not here.
 */
export async function sweepVanished(
  pool: pg.Pool,
  sourceRef: number,
  seenCollapseKeys: string[],
): Promise<{ staled: number; gone: number }> {
  const { rowCount: gone } = await pool.query(
    `UPDATE listings SET status = 'gone'
     WHERE source_ref = $1 AND status = 'stale' AND NOT (collapse_key = ANY($2::text[]))`,
    [sourceRef, seenCollapseKeys],
  )
  const { rowCount: staled } = await pool.query(
    `UPDATE listings SET status = 'stale'
     WHERE source_ref = $1 AND status = 'active' AND NOT (collapse_key = ANY($2::text[]))`,
    [sourceRef, seenCollapseKeys],
  )
  return { staled: staled ?? 0, gone: gone ?? 0 }
}
