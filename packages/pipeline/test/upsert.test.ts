import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '@aptv2/db/test-helpers'
import { buildSeedUnits } from '@aptv2/schema'
import { seedNeighborhoods, upsertProcessedUnits } from '../src/index'

const NOW = new Date('2026-08-27T12:00:00.000Z')

let pool: Pool
const units = buildSeedUnits(NOW)

const normalizedAddress = (u: (typeof units)[number]) =>
  `${u.address_line1} ${u.city} ${u.state} ${u.zip}`.toLowerCase().replace(/\s+/g, ' ')

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await resetTestDb(pool)
  await seedNeighborhoods(pool)
})
afterAll(async () => {
  await pool.end()
})

describe('seedNeighborhoods', () => {
  it('writes one row per centroid-known neighborhood with aliases', async () => {
    const { rows } = await pool.query(
      `SELECT name, aliases FROM neighborhoods WHERE metro = 'orlando' ORDER BY name`,
    )
    expect(rows.length).toBe(8) // the 8 GEO centroids; Lake Nona has no centroid yet
    const eola = rows.find((r) => r.name === 'Lake Eola Heights')!
    expect(eola.aliases).toContain('lake eola')
  })
})

describe('upsertProcessedUnits', () => {
  it('loads all 26 seed listings and is idempotent', async () => {
    const first = await upsertProcessedUnits(pool, units)
    expect(first.listings).toBe(26)
    expect(first.properties).toBe(new Set(units.map(normalizedAddress)).size)

    await upsertProcessedUnits(pool, units) // second run: same state, no dupes
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM listings')
    expect(rows[0].n).toBe(26)
  })

  it('maps the Camellia exemplar faithfully', async () => {
    const { rows } = await pool.query(
      `SELECT l.*, u.beds::float8 AS beds, n.name AS hood
       FROM listings l JOIN units u ON u.id = l.unit_id
       LEFT JOIN neighborhoods n ON n.id = l.neighborhood_id
       WHERE l.collapse_key = 'seed:u0001'`,
    )
    const r = rows[0]
    expect(r.price_cents).toBe(189500)
    expect(r.net_effective_rent_cents).toBe(169317)
    expect(r.beds).toBe(1)
    expect(r.hood).toBe('Lake Eola Heights')
    expect(r.events).toHaveLength(4)
    expect(r.concession.type).toBe('free_weeks')
    expect(r.concession.lease_months).toBe(13)
    expect(r.move_in_fees.map((f: { label: string }) => f.label)).toContain('Application fee')
    expect(r.trust_score).toBeCloseTo(1.0, 5)
    expect(r.search_tsv).toContain('laundri')
  })

  it('models the cross-platform pair as one unit, two listings, one cluster', async () => {
    const { rows } = await pool.query(
      `SELECT l.unit_id, l.dedup_cluster, l.source_platform, l.price_cents
       FROM listings l WHERE l.dedup_cluster = 'orlando:412-e-ridgewood-st-402'
       ORDER BY l.price_cents`,
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].unit_id).toBe(rows[1].unit_id)
    expect(rows.map((r) => r.source_platform).sort()).toEqual(['appfolio', 'rentcafe'])
  })

  it('maps lease terms and price history', async () => {
    const { rows } = await pool.query(
      `SELECT lease_term, price_history, price_changes FROM listings WHERE collapse_key = 'seed:u0003'`,
    )
    // Foundry SoDo: short_term_ok null → 'unknown'; two price drops recorded
    expect(rows[0].lease_term).toBe('unknown')
    expect(rows[0].price_changes).toBe(2)
    expect(rows[0].price_history[0]).toHaveProperty('from_cents')
  })
})
