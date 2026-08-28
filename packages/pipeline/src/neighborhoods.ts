import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type pg from 'pg'
import { NEIGHBORHOOD_ALIASES } from '@aptv2/schema'

// Real neighborhood boundaries (neighborhood-boundaries.json): OSM
// polygons fetched via Nominatim 2026-08-28 (© OpenStreetMap
// contributors, ODbL) — "Downtown Orlando" is OSM's Central Business
// District, "Lake Nona" is Lake Nona South. Mills 50 has no OSM polygon
// and carries a generous hand-drawn box around Mills Ave × Colonial Dr.
// These replaced the Plan-1 bbox placeholders, which contained NO real
// scraped property (even 410 N Orange Ave missed "downtown") and made
// every location-filtered search return zero on the live corpus.
const boundariesFile = fileURLToPath(new URL('./neighborhood-boundaries.json', import.meta.url))

export async function seedNeighborhoods(pool: pg.Pool): Promise<number> {
  const boundaries: Record<string, unknown> = JSON.parse(readFileSync(boundariesFile, 'utf8'))
  let n = 0
  for (const [name, geojson] of Object.entries(boundaries)) {
    const aliases = NEIGHBORHOOD_ALIASES[name] ?? [name.toLowerCase()]
    await pool.query(
      `INSERT INTO neighborhoods (metro, name, aliases, boundary)
       VALUES ('orlando', $1, $2,
               ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)))::geography)
       ON CONFLICT (metro, name) DO UPDATE
         SET aliases = EXCLUDED.aliases, boundary = EXCLUDED.boundary`,
      [name, aliases, JSON.stringify(geojson)],
    )
    n++
  }
  return n
}

/**
 * Re-resolve neighborhood assignment for every stored property and
 * listing against the current boundaries — the backfill that follows a
 * boundary change. Idempotent.
 */
export async function reassignNeighborhoods(pool: pg.Pool): Promise<{ properties: number; listings: number }> {
  const { rowCount: properties } = await pool.query(
    `UPDATE properties p SET neighborhood_id = n.id
     FROM neighborhoods n
     WHERE ST_Covers(n.boundary, p.location)
       AND (p.neighborhood_id IS DISTINCT FROM n.id)`,
  )
  const { rowCount: listings } = await pool.query(
    `UPDATE listings l SET neighborhood_id = n.id
     FROM neighborhoods n
     WHERE ST_Covers(n.boundary, l.location)
       AND (l.neighborhood_id IS DISTINCT FROM n.id)`,
  )
  return { properties: properties ?? 0, listings: listings ?? 0 }
}
