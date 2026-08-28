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
let crashSourceId: number
let partialDupSourceId: number

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
  const { rows: crash } = await pool.query(
    `INSERT INTO sources (platform, name, website_url, endpoint_config)
     VALUES ('entrata', 'Crash Community', 'https://example.com/crash',
             '{"endpoint_url":"https://example.com/crash/feed.json","property":{"name":"Crash Community","address_line1":"5 Fixture St","city":"Orlando","state":"FL","zip":"32801","latitude":28.54,"longitude":-81.38}}')
     RETURNING id`,
  )
  crashSourceId = crash[0].id
  const { rows: partialDup } = await pool.query(
    `INSERT INTO sources (platform, name, website_url, endpoint_config)
     VALUES ('entrata', 'Partial Dup Community', 'https://example.com/partial-dup',
             '{"endpoint_url":"https://example.com/partial-dup/feed.json","property":{"name":"Partial Dup Community","address_line1":"6 Fixture St","city":"Orlando","state":"FL","zip":"32801","latitude":28.54,"longitude":-81.38}}')
     RETURNING id`,
  )
  partialDupSourceId = partialDup[0].id
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
    expect(processed.upserted).toBe(15) // the REST fixture's 15 floorplans
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
    const activeCount = await pool.query(
      `SELECT count(*)::int AS n FROM listings WHERE source_ref = $1 AND status <> 'gone'`, [sourceId],
    )
    const priorProcessed = await pool.query(
      `SELECT id FROM raw_snapshots WHERE source_id = $1 AND processing_status = 'processed' ORDER BY id DESC LIMIT 1`,
      [sourceId],
    )
    const scrape = await runScrape(pool, { fetcher: fetcherFor(payloadText) }, sourceId)
    expect(scrape.unchanged).toBe(true)
    const after = await pool.query(
      `SELECT max(last_confirmed_at) AS t FROM listings WHERE source_ref = $1`, [sourceId],
    )
    expect(new Date(after.rows[0].t).getTime()).toBeGreaterThan(new Date(before.rows[0].t).getTime())
    const snaps = await pool.query(
      `SELECT processing_status, payload FROM raw_snapshots WHERE source_id = $1 ORDER BY id DESC LIMIT 1`, [sourceId],
    )
    expect(snaps.rows[0].processing_status).toBe('skipped_unchanged')
    // Storage economy: the unchanged row stores a pointer to the matched
    // prior snapshot instead of duplicating the (potentially large) payload.
    expect(snaps.rows[0].payload).toEqual({ unchanged_ref: priorProcessed.rows[0].id })
    // The unchanged run must NOT leave listings_found at 0 — the admin
    // delta LATERAL would read that as a phantom mass-delisting.
    const run = await pool.query(
      `SELECT status, listings_found FROM scrape_runs WHERE id = $1`, [scrape.runId],
    )
    expect(run.rows[0].status).toBe('ok')
    expect(run.rows[0].listings_found).toBe(activeCount.rows[0].n)
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
        if (policy && !isPathAllowed(policy, new URL(url).pathname + new URL(url).search)) throw new RobotsDisallowedError(url)
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

  it('a whole-snapshot parse crash marks the run failed and bumps the failure streak (review IMPORTANT 2)', async () => {
    const { rows: run } = await pool.query(
      `INSERT INTO scrape_runs (source_id) VALUES ($1) RETURNING id`, [crashSourceId],
    )
    const runId = run[0].id
    const { rows: snap } = await pool.query(
      `INSERT INTO raw_snapshots (source_id, content_hash, payload, processing_status)
       VALUES ($1, 'crash-hash', $2, 'pending') RETURNING id`,
      [crashSourceId, JSON.stringify({ nonsense: true })],
    )
    const snapshotId = snap[0].id

    await expect(
      runProcess(pool, { llm: null }, { snapshotId, sourceId: crashSourceId, runId }),
    ).rejects.toThrow(/unrecognized payload shape/)

    const runRow = await pool.query(`SELECT status, error FROM scrape_runs WHERE id = $1`, [runId])
    expect(runRow.rows[0].status).toBe('failed')
    expect(runRow.rows[0].error).toMatch(/unrecognized payload shape/)

    const src = await pool.query(`SELECT failure_streak FROM sources WHERE id = $1`, [crashSourceId])
    expect(src.rows[0].failure_streak).toBe(1)

    const snapRow = await pool.query(`SELECT processing_status FROM raw_snapshots WHERE id = $1`, [snapshotId])
    expect(snapRow.rows[0].processing_status).toBe('failed')
  })

  it('a partial-processed snapshot does not short-circuit a same-payload rescrape; a fully-processed one does (prod incident 2026-08-28)', async () => {
    const payload = JSON.parse(payloadText)
    payload[0].bedrooms[0][0].unit_bedrooms = '99'
    const corruptedText = JSON.stringify(payload)

    // Cycle 1: corrupted payload → snapshot ends up 'partial'.
    const cycle1 = await runScrape(pool, { fetcher: fetcherFor(corruptedText) }, partialDupSourceId)
    expect(cycle1.unchanged).toBe(false)
    const cycle1Processed = await runProcess(
      pool, { llm: null }, { snapshotId: cycle1.snapshotId!, sourceId: partialDupSourceId, runId: cycle1.runId },
    )
    expect(cycle1Processed.failures).toBeGreaterThanOrEqual(1)
    const cycle1Snap = await pool.query(`SELECT processing_status FROM raw_snapshots WHERE id = $1`, [cycle1.snapshotId])
    expect(cycle1Snap.rows[0].processing_status).toBe('partial')

    // Cycle 2: SAME (still-corrupted) payload — must NOT short-circuit,
    // because the matched prior snapshot is only 'partial', not 'processed'.
    const cycle2 = await runScrape(pool, { fetcher: fetcherFor(corruptedText) }, partialDupSourceId)
    expect(cycle2.unchanged).toBe(false)
    expect(cycle2.snapshotId).not.toBeNull()
    const cycle2SnapBeforeProcess = await pool.query(
      `SELECT processing_status FROM raw_snapshots WHERE id = $1`, [cycle2.snapshotId],
    )
    expect(cycle2SnapBeforeProcess.rows[0].processing_status).toBe('pending')

    // "Processing rerun" (brief's own phrase): actually reprocess cycle 2's
    // snapshot rather than leaving it forever 'pending'. Content is still
    // byte-identical to cycle 1's corrupted payload, so this reprocessing
    // deterministically fails the same unit again — a genuinely CLEAN
    // extraction only becomes possible once the payload itself is fixed,
    // which is what the next (clean) round below does. The point proven
    // here is narrower but real: reprocessing runs to completion (no crash)
    // and correctly re-marks the snapshot 'partial', instead of silently
    // leaving a permanently-'pending', never-retried row.
    const cycle2Processed = await runProcess(
      pool, { llm: null }, { snapshotId: cycle2.snapshotId!, sourceId: partialDupSourceId, runId: cycle2.runId },
    )
    expect(cycle2Processed.failures).toBeGreaterThanOrEqual(1)
    const cycle2SnapAfterProcess = await pool.query(
      `SELECT processing_status FROM raw_snapshots WHERE id = $1`, [cycle2.snapshotId],
    )
    expect(cycle2SnapAfterProcess.rows[0].processing_status).toBe('partial')

    // Fully-clean process: fix the payload and reprocess cleanly.
    const clean = await runScrape(pool, { fetcher: fetcherFor(payloadText) }, partialDupSourceId)
    expect(clean.unchanged).toBe(false)
    const cleanProcessed = await runProcess(
      pool, { llm: null }, { snapshotId: clean.snapshotId!, sourceId: partialDupSourceId, runId: clean.runId },
    )
    expect(cleanProcessed.failures).toBe(0) // genuinely clean extraction, now that the content itself is fixed
    const cleanSnap = await pool.query(`SELECT processing_status FROM raw_snapshots WHERE id = $1`, [clean.snapshotId])
    expect(cleanSnap.rows[0].processing_status).toBe('processed')

    // Cycle 3: same clean payload — the matched prior snapshot IS
    // 'processed', so this one short-circuits as usual.
    const beforeCycle3 = await pool.query(
      `SELECT max(last_confirmed_at) AS t FROM listings WHERE source_ref = $1`, [partialDupSourceId],
    )
    const cycle3 = await runScrape(pool, { fetcher: fetcherFor(payloadText) }, partialDupSourceId)
    expect(cycle3.unchanged).toBe(true)
    expect(cycle3.snapshotId).toBeNull()
    // Confirmations bumped for THIS source (the unchanged path still
    // confirms every active listing is live) and the stub payload written
    // for THIS source's cycle-3 row points at the matched 'processed' snapshot.
    const afterCycle3 = await pool.query(
      `SELECT max(last_confirmed_at) AS t FROM listings WHERE source_ref = $1`, [partialDupSourceId],
    )
    expect(new Date(afterCycle3.rows[0].t).getTime()).toBeGreaterThan(new Date(beforeCycle3.rows[0].t).getTime())
    const cycle3Snap = await pool.query(
      `SELECT payload FROM raw_snapshots WHERE source_id = $1 ORDER BY id DESC LIMIT 1`, [partialDupSourceId],
    )
    expect(cycle3Snap.rows[0].payload).toEqual({ unchanged_ref: clean.snapshotId })
  })

  it('a legacy robots_policy row (no `allow` key) does not crash the scrape (review CRITICAL 1)', async () => {
    const { rows: legacy } = await pool.query(
      `INSERT INTO sources (platform, name, website_url, endpoint_config, robots_policy)
       VALUES ('entrata', 'Legacy Policy Community', 'https://example.com/legacy-policy',
               '{"endpoint_url":"https://example.com/legacy-policy/feed.json","property":{"name":"Legacy Policy Community","address_line1":"7 Fixture St","city":"Orlando","state":"FL","zip":"32801","latitude":28.54,"longitude":-81.38}}',
               '{"disallow": ["/admin"], "crawlDelaySeconds": null}')
       RETURNING id`,
    )
    const legacySourceId = legacy[0].id
    // The robots.txt refresh 404s, so runScrape keeps the STORED legacy
    // policy (no `allow` key) and gates the endpoint fetch with it. This
    // stub mirrors the REAL politeness fetcher's own gate (politeness.ts's
    // politeRequest calls isPathAllowed with exactly this policy) — a fake
    // that ignored the policy entirely wouldn't exercise the crash at all.
    const fetcher: PoliteFetcher = {
      fetchJson: async () => {
        throw new Error('fetchJson should never be called by the entrata adapter')
      },
      fetchText: async (url, policy) => {
        if (url.endsWith('/robots.txt')) return { status: 404, body: '' }
        if (policy && !isPathAllowed(policy, new URL(url).pathname + new URL(url).search)) throw new RobotsDisallowedError(url)
        return { status: 200, body: payloadText }
      },
    }
    const result = await runScrape(pool, { fetcher }, legacySourceId)
    expect(result.unchanged).toBe(false)
    const run = await pool.query(`SELECT status FROM scrape_runs WHERE id = $1`, [result.runId])
    expect(run.rows[0].status).toBe('ok')
  })
})
