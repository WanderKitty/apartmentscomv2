import type pg from 'pg'
import { GEO, NEIGHBORHOOD_ALIASES } from '@aptv2/schema'

// Seed-approximate neighborhood boundaries: a bbox around each demo
// centroid, half-width 0.005° (~550m). Adjacent boxes DO overlap
// (Lake Eola / Downtown / Thornton centroids are ~0.006–0.007° apart,
// less than the 0.010° two boxes need to stay disjoint), and boxes are
// NOT guaranteed to contain only their own hood's listings — two known
// seed listings sit in a neighboring hood's box as well as their own:
// Ridgewood House (28.545, -81.376, labeled Lake Eola Heights) also
// falls inside the Downtown Orlando box, and Eola Commons (28.5462,
// -81.3708, labeled Lake Eola Heights) also falls inside the Thornton
// Park box. This is acceptable for the placeholder geo because the
// search filters are EXISTS-any (a listing matching ANY requested
// neighborhood box passes) and MIN-distance (proximity scoring), not an
// exclusive assignment — a listing counted under an extra box never
// produces a wrong exclusive answer. Replaced by real polygons (Orlando
// open data / OSM) post-demo.
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
