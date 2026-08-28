import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '@aptv2/db/test-helpers'
import { buildSeedUnits } from '@aptv2/schema'
import { seedNeighborhoods, upsertProcessedUnits, bumpConfirmed, sweepVanished } from '../src/index'

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

describe('ingestion helpers', () => {
  it('spatial neighborhood fallback: empty-name record inside the Lake Eola bbox resolves', async () => {
    const u = {
      ...buildSeedUnits(NOW)[0]!,
      source_id: 'entrata___spatial-test-1',
      collapse_key: 'entrata:spatial-test-1',
      liberal_dedup_cluster: 'orlando:spatial-test-1',
      neighborhood: '',
      platform: 'entrata' as const,
      data_provenance: 'scraped' as const,
    }
    const { rows: src } = await pool.query(
      `INSERT INTO sources (platform, name, website_url) VALUES ('entrata','Spatial Test','https://example.com/spatial')
       ON CONFLICT (website_url) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    )
    await upsertProcessedUnits(pool, [u], { sourceRef: src[0].id })
    const { rows } = await pool.query(
      `SELECT l.source_ref, n.name FROM listings l JOIN neighborhoods n ON n.id = l.neighborhood_id
       WHERE l.collapse_key = 'entrata:spatial-test-1'`,
    )
    expect(rows[0].source_ref).toBe(src[0].id)
    expect(rows[0].name).toBe('Lake Eola Heights') // seed unit 1's coords sit in the Eola bbox
  })

  it('price history accumulates across upserts instead of being overwritten', async () => {
    const base = {
      ...buildSeedUnits(NOW)[0]!,
      source_id: 'entrata___pricehist-1',
      collapse_key: 'entrata:pricehist-1',
      liberal_dedup_cluster: 'orlando:pricehist-1',
      platform: 'entrata' as const,
      data_provenance: 'scraped' as const,
      advertised_rent_cents: 200000,
      net_effective_monthly_cents: null,
      concession_type: 'not_mentioned' as const,
      events: [{ at: NOW.toISOString(), kind: 'first_listed' as const, from_cents: null, to_cents: 200000, note: null }],
    }
    await upsertProcessedUnits(pool, [base])
    // Second scrape cycle: rent dropped $150.
    await upsertProcessedUnits(pool, [{
      ...base,
      advertised_rent_cents: 185000,
      events: [{ at: NOW.toISOString(), kind: 'first_listed' as const, from_cents: null, to_cents: 185000, note: null }],
    }])
    const { rows } = await pool.query(
      `SELECT price_cents, events, price_history, price_changes FROM listings WHERE collapse_key = 'entrata:pricehist-1'`,
    )
    const r = rows[0]
    expect(r.price_cents).toBe(185000)
    const priceEvents = r.events.filter((e: { kind: string }) => e.kind === 'price_drop' || e.kind === 'price_increase')
    expect(priceEvents).toHaveLength(1)
    expect(priceEvents[0]).toMatchObject({ kind: 'price_drop', from_cents: 200000, to_cents: 185000 })
    expect(r.events[0].kind).toBe('first_listed') // prior history survived
    expect(r.price_history).toHaveLength(1)
    expect(r.price_history[0]).toMatchObject({ from_cents: 200000, to_cents: 185000 })
    expect(r.price_changes).toBe(1)
    // Third cycle, unchanged price: nothing appended.
    await upsertProcessedUnits(pool, [{ ...base, advertised_rent_cents: 185000 }])
    const again = await pool.query(`SELECT events, price_changes FROM listings WHERE collapse_key = 'entrata:pricehist-1'`)
    expect(again.rows[0].events).toHaveLength(r.events.length)
    expect(again.rows[0].price_changes).toBe(1)
  })

  it('bumpConfirmed and sweepVanished implement the confirm/stale/gone ladder', async () => {
    const { rows: src } = await pool.query(`SELECT id FROM sources WHERE website_url = 'https://example.com/spatial'`)
    const ref = src[0].id
    const bumped = await bumpConfirmed(pool, ref, new Date('2026-08-28T12:00:00.000Z'))
    expect(bumped).toBe(1)

    const s1 = await sweepVanished(pool, ref, []) // not seen → stale
    expect(s1).toEqual({ staled: 1, gone: 0 })
    const s2 = await sweepVanished(pool, ref, []) // still not seen → gone
    expect(s2).toEqual({ staled: 0, gone: 1 })
    const { rows } = await pool.query(`SELECT status FROM listings WHERE collapse_key = 'entrata:spatial-test-1'`)
    expect(rows[0].status).toBe('gone')
  })
})
