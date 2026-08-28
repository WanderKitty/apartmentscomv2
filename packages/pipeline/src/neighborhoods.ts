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
               ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)), 3))::geography)
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
 * boundary change. Deterministic where polygons overlap (the smallest
 * covering polygon wins), un-assigns rows no polygon covers, and is
 * idempotent: a second run changes zero rows.
 */
export async function reassignNeighborhoods(pool: pg.Pool): Promise<{ properties: number; listings: number }> {
  const resolve = (table: string, locCol: string) => `
    UPDATE ${table} t SET neighborhood_id = w.winner
    FROM (
      SELECT t2.id AS row_id,
             (SELECT n.id FROM neighborhoods n
              WHERE ST_Covers(n.boundary, t2.${locCol})
              ORDER BY ST_Area(n.boundary::geometry), n.id
              LIMIT 1) AS winner
      FROM ${table} t2
    ) w
    WHERE w.row_id = t.id AND t.neighborhood_id IS DISTINCT FROM w.winner`
  const { rowCount: properties } = await pool.query(resolve('properties', 'location'))
  const { rowCount: listings } = await pool.query(resolve('listings', 'location'))
  return { properties: properties ?? 0, listings: listings ?? 0 }
}
