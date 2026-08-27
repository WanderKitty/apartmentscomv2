import type pg from 'pg'
import { GEO, NEIGHBORHOOD_ALIASES } from '@aptv2/schema'

// Seed-approximate neighborhood boundaries: a bbox around each demo
// centroid, half-width 0.005° (~550m). Adjacent boxes DO overlap
// (Lake Eola / Downtown / Thornton centroids are ~0.006–0.007° apart,
// less than the 0.010° two boxes need to stay disjoint) — that is fine:
// the search filters are EXISTS-any and MIN-distance, and what the seed
// corpus relies on is only that each box contains no OTHER hood's
// listings, which holds because every foreign centroid is >0.005° away
// on at least one axis. Replaced by real polygons (Orlando open data /
// OSM) post-demo.
const HALF = 0.005

export async function seedNeighborhoods(pool: pg.Pool): Promise<number> {
  let n = 0
  for (const [name, [lat, lng]] of Object.entries(GEO)) {
    const aliases = NEIGHBORHOOD_ALIASES[name] ?? [name.toLowerCase()]
    await pool.query(
      `INSERT INTO neighborhoods (metro, name, aliases, boundary)
       VALUES ('orlando', $1, $2,
               ST_Multi(ST_MakeEnvelope($3, $4, $5, $6, 4326))::geography)
       ON CONFLICT (metro, name) DO UPDATE
         SET aliases = EXCLUDED.aliases, boundary = EXCLUDED.boundary`,
      [name, aliases, lng - HALF, lat - HALF, lng + HALF, lat + HALF],
    )
    n++
  }
  return n
}
