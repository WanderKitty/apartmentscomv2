import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '@aptv2/db/test-helpers'
import { seedNeighborhoods } from '@aptv2/pipeline'
import { RobotsDisallowedError, isPathAllowed, type PoliteFetcher } from '@aptv2/scrapers'
import { runProcess, runScrape } from '../src/jobs/scrape'

const payloadText = readFileSync(
  fileURLToPath(new URL('../../../packages/scrapers/fixtures/entrata-availability.json', import.meta.url)),
  'utf8',
)

let pool: Pool
let sourceId: number
let disabledSourceId: number
let robotsSourceId: number
let corruptedSourceId: number

// The adapter always fetches via fetchText (Task 4 ruling 2) and does its
// own JSON.parse; robots.txt is also fetched via fetchText, so this stub
// dispatches on the URL: robots.txt "misses" (404) so the stored policy is
// left alone, and the endpoint URL returns the fixture payload verbatim.
const fetcherFor = (body: string): PoliteFetcher => ({
  fetchJson: async () => {
    throw new Error('fetchJson should never be called by the entrata adapter')
  },
  fetchText: async (url: string) => {
    if (url.endsWith('/robots.txt')) return { status: 404, body: '' }
    return { status: 200, body }
  },
})

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await resetTestDb(pool)
  await seedNeighborhoods(pool)
  const { rows } = await pool.query(
    `INSERT INTO sources (platform, name, website_url, endpoint_config)
     VALUES ('entrata', 'Fixture Community', 'https://example.com',
             '{"endpoint_url":"https://example.com/feed.json","property":{"name":"Fixture Community","address_line1":"1 Fixture St","city":"Orlando","state":"FL","zip":"32801","latitude":28.54,"longitude":-81.38}}')
     RETURNING id`,
  )
  sourceId = rows[0].id
  const { rows: disabled } = await pool.query(
    `INSERT INTO sources (platform, name, website_url, endpoint_config, enabled)
     VALUES ('entrata', 'Disabled Community', 'https://example.com/disabled',
             '{"endpoint_url":"https://example.com/disabled/feed.json","property":{"name":"Disabled Community","address_line1":"2 Fixture St","city":"Orlando","state":"FL","zip":"32801","latitude":28.54,"longitude":-81.38}}',
             false)
     RETURNING id`,
  )
  disabledSourceId = disabled[0].id
  const { rows: robots } = await pool.query(
    `INSERT INTO sources (platform, name, website_url, endpoint_config)
     VALUES ('entrata', 'Robots Community', 'https://example.com/robots-test',
             '{"endpoint_url":"https://example.com/robots-test/feed.json","property":{"name":"Robots Community","address_line1":"3 Fixture St","city":"Orlando","state":"FL","zip":"32801","latitude":28.54,"longitude":-81.38}}')
     RETURNING id`,
  )
  robotsSourceId = robots[0].id
  const { rows: corrupted } = await pool.query(
    `INSERT INTO sources (platform, name, website_url, endpoint_config)
     VALUES ('entrata', 'Corrupted Community', 'https://example.com/corrupted',
             '{"endpoint_url":"https://example.com/corrupted/feed.json","property":{"name":"Corrupted Community","address_line1":"4 Fixture St","city":"Orlando","state":"FL","zip":"32801","latitude":28.54,"longitude":-81.38}}')
     RETURNING id`,
  )
  corruptedSourceId = corrupted[0].id
})
afterAll(async () => {
  await pool.end()
})

describe('runScrape → runProcess', () => {
  it('first run: snapshot stored verbatim, run recorded, processing yields active listings', async () => {
    const scrape = await runScrape(pool, { fetcher: fetcherFor(payloadText) }, sourceId)
    expect(scrape.unchanged).toBe(false)
    const snap = await pool.query(`SELECT id, processing_status FROM raw_snapshots WHERE source_id = $1`, [sourceId])
    expect(snap.rows).toHaveLength(1)

    const processed = await runProcess(pool, { llm: null }, { snapshotId: snap.rows[0].id, sourceId, runId: scrape.runId })
    expect(processed.failures).toBe(0)
    expect(processed.upserted).toBe(15) // the REST fixture's 15 floorplans (Task 4 report)
    const listings = await pool.query(
      `SELECT count(*)::int AS n FROM listings WHERE source_ref = $1 AND status = 'active'`, [sourceId],
    )
    expect(listings.rows[0].n).toBe(processed.upserted)
    const status = await pool.query(`SELECT processing_status FROM raw_snapshots WHERE id = $1`, [snap.rows[0].id])
    expect(status.rows[0].processing_status).toBe('processed')
    const run = await pool.query(
      `SELECT status, listings_found FROM scrape_runs WHERE source_id = $1 ORDER BY id DESC LIMIT 1`, [sourceId],
    )
    expect(run.rows[0].status).toBe('ok')
    expect(run.rows[0].listings_found).toBe(processed.upserted)
  })

  it('unchanged payload short-circuits: no new pending snapshot, last_confirmed_at bumped', async () => {
    const before = await pool.query(
      `SELECT max(last_confirmed_at) AS t FROM listings WHERE source_ref = $1`, [sourceId],
    )
    const scrape = await runScrape(pool, { fetcher: fetcherFor(payloadText) }, sourceId)
    expect(scrape.unchanged).toBe(true)
    const after = await pool.query(
      `SELECT max(last_confirmed_at) AS t FROM listings WHERE source_ref = $1`, [sourceId],
    )
    expect(new Date(after.rows[0].t).getTime()).toBeGreaterThan(new Date(before.rows[0].t).getTime())
    const snaps = await pool.query(
      `SELECT processing_status FROM raw_snapshots WHERE source_id = $1 ORDER BY id DESC LIMIT 1`, [sourceId],
    )
    expect(snaps.rows[0].processing_status).toBe('skipped_unchanged')
  })

  it('a failed fetch records a failed run and bumps the failure streak', async () => {
    const failing: PoliteFetcher = {
      fetchJson: async () => { throw new Error('boom 503') },
      fetchText: async () => { throw new Error('boom 503') },
    }
    await expect(runScrape(pool, { fetcher: failing }, sourceId)).rejects.toThrow(/boom/)
    const run = await pool.query(
      `SELECT status, error FROM scrape_runs WHERE source_id = $1 ORDER BY id DESC LIMIT 1`, [sourceId],
    )
    expect(run.rows[0].status).toBe('failed')
    expect(run.rows[0].error).toMatch(/boom/)
    const src = await pool.query(`SELECT failure_streak FROM sources WHERE id = $1`, [sourceId])
    expect(src.rows[0].failure_streak).toBe(1)
  })

  it('a successful run resets the failure streak and updates last_scraped_at', async () => {
    await runScrape(pool, { fetcher: fetcherFor(payloadText) }, sourceId)
    const src = await pool.query(`SELECT failure_streak, last_scraped_at FROM sources WHERE id = $1`, [sourceId])
    expect(src.rows[0].failure_streak).toBe(0)
    expect(src.rows[0].last_scraped_at).not.toBeNull()
  })

  it('a disabled source rejects and records nothing', async () => {
    const before = await pool.query(`SELECT count(*)::int AS n FROM scrape_runs WHERE source_id = $1`, [disabledSourceId])
    await expect(runScrape(pool, { fetcher: fetcherFor(payloadText) }, disabledSourceId)).rejects.toThrow(/missing or disabled/)
    const after = await pool.query(`SELECT count(*)::int AS n FROM scrape_runs WHERE source_id = $1`, [disabledSourceId])
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })

  it('a freshly refreshed robots disallow gates the SAME-cycle endpoint fetch (review CRITICAL 1)', async () => {
    let endpointFetched = false
    const fetcher: PoliteFetcher = {
      fetchJson: async () => {
        throw new Error('fetchJson should never be called by the entrata adapter')
      },
      fetchText: async (url, policy) => {
        if (url.endsWith('/robots.txt')) return { status: 200, body: 'User-agent: *\nDisallow: /robots-test/feed.json\n' }
        // Mirrors createPoliteFetcher's own gate (politeness.ts's politeRequest):
        // if the policy passed in disallows this path, the real fetcher
        // would throw before ever reaching the network.
        if (policy && !isPathAllowed(policy, new URL(url).pathname)) throw new RobotsDisallowedError(url)
        endpointFetched = true
        return { status: 200, body: payloadText }
      },
    }
    await expect(runScrape(pool, { fetcher }, robotsSourceId)).rejects.toThrow(/robots\.txt disallows/)
    expect(endpointFetched).toBe(false)
    const run = await pool.query(
      `SELECT status, error FROM scrape_runs WHERE source_id = $1 ORDER BY id DESC LIMIT 1`, [robotsSourceId],
    )
    expect(run.rows[0].status).toBe('failed')
    expect(run.rows[0].error).toMatch(/robots\.txt disallows/)
  })

  it('a corrupted unit fails extraction without staling other active listings of that source (review IMPORTANT 2)', async () => {
    // Clean cycle first: 15/15 upsert, all active.
    const clean = await runScrape(pool, { fetcher: fetcherFor(payloadText) }, corruptedSourceId)
    const cleanSnap = await pool.query(
      `SELECT id FROM raw_snapshots WHERE source_id = $1 ORDER BY id DESC LIMIT 1`, [corruptedSourceId],
    )
    const cleanProcessed = await runProcess(
      pool, { llm: null }, { snapshotId: cleanSnap.rows[0].id, sourceId: corruptedSourceId, runId: clean.runId },
    )
    expect(cleanProcessed.failures).toBe(0)
    expect(cleanProcessed.upserted).toBe(15)
    const activeBefore = await pool.query(
      `SELECT count(*)::int AS n FROM listings WHERE source_ref = $1 AND status = 'active'`, [corruptedSourceId],
    )
    expect(activeBefore.rows[0].n).toBe(15)

    // Corrupted cycle: one floorplan's beds becomes schema-invalid (max 6).
    const payload = JSON.parse(payloadText)
    payload[0].bedrooms[0][0].unit_bedrooms = '99'
    const corruptedText = JSON.stringify(payload)
    const corrupted = await runScrape(pool, { fetcher: fetcherFor(corruptedText) }, corruptedSourceId)
    expect(corrupted.unchanged).toBe(false) // payload differs → new snapshot, not the hash short-circuit
    const corruptedProcessed = await runProcess(
      pool, { llm: null }, { snapshotId: corrupted.snapshotId!, sourceId: corruptedSourceId, runId: corrupted.runId },
    )
    expect(corruptedProcessed.failures).toBeGreaterThanOrEqual(1)

    const activeAfter = await pool.query(
      `SELECT count(*)::int AS n FROM listings WHERE source_ref = $1 AND status = 'active'`, [corruptedSourceId],
    )
    const staleAfter = await pool.query(
      `SELECT count(*)::int AS n FROM listings WHERE source_ref = $1 AND status = 'stale'`, [corruptedSourceId],
    )
    // No previously-active listing was staled by the incomplete (failure-tainted) sweep.
    expect(staleAfter.rows[0].n).toBe(0)
    expect(activeAfter.rows[0].n).toBe(activeBefore.rows[0].n)

    const run = await pool.query(
      `SELECT status, error, listings_found FROM scrape_runs WHERE id = $1`, [corrupted.runId],
    )
    expect(run.rows[0].status).toBe('partial')
    expect(run.rows[0].error).toMatch(/unit\(s\) failed extraction/)
    expect(run.rows[0].listings_found).toBe(corruptedProcessed.upserted)
  })
})
