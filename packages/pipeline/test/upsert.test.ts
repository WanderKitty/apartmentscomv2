import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '@aptv2/db/test-helpers'
import { buildSeedUnits } from '@aptv2/schema'
import { reassignNeighborhoods, seedNeighborhoods, upsertProcessedUnits, bumpConfirmed, sweepVanished } from '../src/index'

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
  it('writes one row per boundary-known neighborhood with aliases', async () => {
    const { rows } = await pool.query(
      `SELECT name, aliases FROM neighborhoods WHERE metro = 'orlando' ORDER BY name`,
    )
    expect(rows.length).toBe(9) // real OSM polygons incl. Lake Nona; Mills 50 is a hand box
    const eola = rows.find((r) => r.name === 'Lake Eola Heights')!
    expect(eola.aliases).toContain('lake eola')
  })

  it('reassignNeighborhoods backfills rows stranded without an assignment', async () => {
    const stranded = {
      ...units[0]!,
      source_id: 'entrata___downtown-backfill-test',
      collapse_key: 'entrata:downtown-backfill-test',
      liberal_dedup_cluster: 'orlando:downtown-backfill-test',
      property_name: 'Downtown Backfill Fixture',
      address_line1: '410 N Orange Ave',
      latitude: 28.5484,
      longitude: -81.3786,
      neighborhood: '',
    }
    await upsertProcessedUnits(pool, [stranded])
    // Simulate the pre-polygon state: assignment lost.
    await pool.query(`UPDATE listings SET neighborhood_id = NULL WHERE collapse_key = 'entrata:downtown-backfill-test'`)
    await reassignNeighborhoods(pool)
    const { rows } = await pool.query(
      `SELECT n.name FROM listings l JOIN neighborhoods n ON n.id = l.neighborhood_id
       WHERE l.collapse_key = 'entrata:downtown-backfill-test'`,
    )
    expect(rows[0]?.name).toBe('Downtown Orlando')
    // The later corpus-count assertions expect exactly the 26 seed rows.
    await pool.query(`DELETE FROM listings WHERE collapse_key = 'entrata:downtown-backfill-test'`)
  })

  it('real polygons contain real properties: 410 N Orange Ave resolves to Downtown Orlando', async () => {
    // Society Orlando's actual location — under the old bbox placeholders
    // it resolved to NO neighborhood, which zeroed every location search
    // on the scraped corpus.
    const { rows } = await pool.query(
      `SELECT name FROM neighborhoods
       WHERE ST_Covers(boundary, ST_SetSRID(ST_MakePoint(-81.3786, 28.5484), 4326)::geography)`,
    )
    expect(rows.map((r) => r.name)).toContain('Downtown Orlando')
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

  it('persists image_url on the unit row, and updates it on conflict', async () => {
    const withImage = {
      ...units[0]!,
      image_url: 'https://example.com/floorplans/a1.jpg',
    }
    await upsertProcessedUnits(pool, [withImage])
    const { rows } = await pool.query(
      `SELECT u.image_url FROM listings l JOIN units u ON u.id = l.unit_id
       WHERE l.collapse_key = $1`,
      [withImage.collapse_key],
    )
    expect(rows[0].image_url).toBe('https://example.com/floorplans/a1.jpg')

    // Conflict path: a later scrape with a new image replaces the old one.
    await upsertProcessedUnits(pool, [{ ...withImage, image_url: 'https://example.com/floorplans/a1-v2.jpg' }])
    const { rows: after } = await pool.query(
      `SELECT u.image_url FROM listings l JOIN units u ON u.id = l.unit_id
       WHERE l.collapse_key = $1`,
      [withImage.collapse_key],
    )
    expect(after[0].image_url).toBe('https://example.com/floorplans/a1-v2.jpg')

    // The COALESCE invariant: a cycle WITHOUT an image must keep the
    // known image, not erase it.
    await upsertProcessedUnits(pool, [{ ...withImage, image_url: null }])
    const { rows: kept } = await pool.query(
      `SELECT u.image_url FROM listings l JOIN units u ON u.id = l.unit_id
       WHERE l.collapse_key = $1`,
      [withImage.collapse_key],
    )
    expect(kept[0].image_url).toBe('https://example.com/floorplans/a1-v2.jpg')
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

  it('a price increase appends kind price_increase with correct from/to', async () => {
    const base = {
      ...buildSeedUnits(NOW)[0]!,
      source_id: 'entrata___priceinc-1',
      collapse_key: 'entrata:priceinc-1',
      liberal_dedup_cluster: 'orlando:priceinc-1',
      platform: 'entrata' as const,
      data_provenance: 'scraped' as const,
      advertised_rent_cents: 150000,
      net_effective_monthly_cents: null,
      concession_type: 'not_mentioned' as const,
      events: [{ at: NOW.toISOString(), kind: 'first_listed' as const, from_cents: null, to_cents: 150000, note: null }],
    }
    await upsertProcessedUnits(pool, [base])
    // Second scrape cycle: rent went up $120.
    await upsertProcessedUnits(pool, [{
      ...base,
      advertised_rent_cents: 162000,
      events: [{ at: NOW.toISOString(), kind: 'first_listed' as const, from_cents: null, to_cents: 162000, note: null }],
    }])
    const { rows } = await pool.query(
      `SELECT price_cents, events, price_history, price_changes FROM listings WHERE collapse_key = 'entrata:priceinc-1'`,
    )
    const r = rows[0]
    expect(r.price_cents).toBe(162000)
    const priceEvents = r.events.filter((e: { kind: string }) => e.kind === 'price_drop' || e.kind === 'price_increase')
    expect(priceEvents).toHaveLength(1)
    expect(priceEvents[0]).toMatchObject({ kind: 'price_increase', from_cents: 150000, to_cents: 162000 })
    expect(r.price_history).toHaveLength(1)
    expect(r.price_history[0]).toMatchObject({ from_cents: 150000, to_cents: 162000 })
    expect(r.price_changes).toBe(1)
  })

  it('a null-to-non-null price transition appends nothing but still updates price_cents', async () => {
    const base = {
      ...buildSeedUnits(NOW)[0]!,
      source_id: 'entrata___pricenull-1',
      collapse_key: 'entrata:pricenull-1',
      liberal_dedup_cluster: 'orlando:pricenull-1',
      platform: 'entrata' as const,
      data_provenance: 'scraped' as const,
      advertised_rent_cents: null,
      net_effective_monthly_cents: null,
      concession_type: 'not_mentioned' as const,
      events: [{ at: NOW.toISOString(), kind: 'first_listed' as const, from_cents: null, to_cents: null, note: null }],
    }
    await upsertProcessedUnits(pool, [base])
    // Second scrape cycle: price becomes known — the null→non-null edge is unclassifiable, not a "change".
    await upsertProcessedUnits(pool, [{
      ...base,
      advertised_rent_cents: 175000,
      events: [{ at: NOW.toISOString(), kind: 'first_listed' as const, from_cents: null, to_cents: 175000, note: null }],
    }])
    const { rows } = await pool.query(
      `SELECT price_cents, events, price_history, price_changes FROM listings WHERE collapse_key = 'entrata:pricenull-1'`,
    )
    const r = rows[0]
    expect(r.price_cents).toBe(175000)
    const priceEvents = r.events.filter((e: { kind: string }) => e.kind === 'price_drop' || e.kind === 'price_increase')
    expect(priceEvents).toHaveLength(0)
    expect(r.price_history).toHaveLength(0)
    expect(r.price_changes).toBe(0)
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
