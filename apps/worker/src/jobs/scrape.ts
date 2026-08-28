import type pg from 'pg'
import type PgBoss from 'pg-boss'
import {
  createPoliteFetcher, parseRobots, entrataAdapter, sha256Json,
  type PoliteFetcher, type SourceRow,
} from '@aptv2/scrapers'
import {
  bumpConfirmed, createHaikuEnricher, extractSnapshot, sweepVanished,
  upsertProcessedUnits, type LlmEnricher,
} from '@aptv2/pipeline'

export const SCRAPE = 'scrape'
export const PROCESS = 'process-snapshot'
// Internal-only queue: the cron trigger that fans scrape jobs out to every
// enabled source (see registerIngestionJobs's pg-boss-v10 note below).
const SCRAPE_SWEEP = 'scrape-sweep'

async function loadSource(pool: pg.Pool, id: number): Promise<SourceRow> {
  const { rows } = await pool.query(`SELECT * FROM sources WHERE id = $1 AND enabled`, [id])
  if (!rows[0]) throw new Error(`source ${id} missing or disabled`)
  return rows[0] as SourceRow
}

/** Stage 2 (spec §5.2). Returns { unchanged, snapshotId }. Throws on fetch failure AFTER recording the failed run. */
export async function runScrape(
  pool: pg.Pool,
  deps: { fetcher: PoliteFetcher },
  sourceId: number,
): Promise<{ unchanged: boolean; snapshotId: number | null }> {
  const source = await loadSource(pool, sourceId)
  const { rows: run } = await pool.query(
    `INSERT INTO scrape_runs (source_id) VALUES ($1) RETURNING id`, [sourceId],
  )
  const runId = run[0]!.id
  try {
    // Refresh robots policy once per run (cheap; cached in the sources row).
    let policy = source.robots_policy
    try {
      const origin = new URL(source.website_url).origin
      const res = await deps.fetcher.fetchText(`${origin}/robots.txt`, null)
      if (res.status === 200) policy = parseRobots(res.body, 'aptv2-research-bot')
    } catch { /* robots fetch failure keeps the stored policy — recorded below either way */ }

    const snap = await entrataAdapter.fetch(source, deps.fetcher)
    const { rows: dup } = await pool.query(
      `SELECT 1 FROM raw_snapshots WHERE source_id = $1 AND content_hash = $2 LIMIT 1`,
      [sourceId, snap.content_hash],
    )
    const unchanged = dup.length > 0
    const { rows: inserted } = await pool.query(
      `INSERT INTO raw_snapshots (source_id, content_hash, payload, processing_status)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [sourceId, snap.content_hash, JSON.stringify(snap.payload), unchanged ? 'skipped_unchanged' : 'pending'],
    )
    if (unchanged) await bumpConfirmed(pool, sourceId, new Date()) // hash short-circuit still confirms
    await pool.query(
      `UPDATE sources SET last_scraped_at = now(), failure_streak = 0, robots_policy = $2 WHERE id = $1`,
      [sourceId, policy === null ? null : JSON.stringify(policy)],
    )
    await pool.query(
      `UPDATE scrape_runs SET finished_at = now(), status = 'ok' WHERE id = $1`, [runId],
    )
    return { unchanged, snapshotId: unchanged ? null : inserted[0]!.id }
  } catch (e) {
    await pool.query(
      `UPDATE scrape_runs SET finished_at = now(), status = 'failed', error = $2 WHERE id = $1`,
      [runId, (e as Error).message],
    )
    await pool.query(`UPDATE sources SET failure_streak = failure_streak + 1 WHERE id = $1`, [sourceId])
    throw e // pg-boss retries with backoff; the failure is recorded, not swallowed (spec §5)
  }
}

/** Stages 3–5 for one snapshot. Partial failure: bad units are counted in the run row. */
export async function runProcess(
  pool: pg.Pool,
  deps: { llm: LlmEnricher | null },
  data: { snapshotId: number; sourceId: number },
): Promise<{ upserted: number; failures: number }> {
  const source = await loadSource(pool, data.sourceId)
  const { rows: snaps } = await pool.query(`SELECT id, source_id, payload FROM raw_snapshots WHERE id = $1`, [data.snapshotId])
  if (!snaps[0]) throw new Error(`snapshot ${data.snapshotId} missing`)
  try {
    const { units, failures } = await extractSnapshot(pool, {
      snapshot: snaps[0], source, now: new Date(), llm: deps.llm,
    })
    await upsertProcessedUnits(pool, units, { sourceRef: data.sourceId })
    await sweepVanished(pool, data.sourceId, units.map((u) => u.collapse_key))
    await pool.query(`UPDATE raw_snapshots SET processing_status = 'processed' WHERE id = $1`, [data.snapshotId])
    await pool.query(
      `UPDATE scrape_runs SET listings_found = $2, listings_changed = $3
       WHERE id = (SELECT max(id) FROM scrape_runs WHERE source_id = $1)`,
      [data.sourceId, units.length, failures.length],
    )
    if (failures.length > 0) console.error(`[process] ${failures.length} unit(s) failed:`, failures)
    return { upserted: units.length, failures: failures.length }
  } catch (e) {
    await pool.query(
      `UPDATE raw_snapshots SET processing_status = 'failed', error = $2 WHERE id = $1`,
      [data.snapshotId, (e as Error).message],
    )
    throw e
  }
}

/**
 * pg-boss v10 keys its `schedule` table by queue name alone (PRIMARY KEY
 * (name), FK to the queue table — see node_modules/pg-boss/src/plans.js's
 * createTableSchedule/schedule()), so a single queue can carry only ONE
 * cron schedule with ONE fixed data payload. Per-source cron schedules on
 * the shared `scrape` queue therefore can't each carry their own
 * `{ sourceId }` the way the brief's literal per-source `boss.schedule`
 * loop assumes. Fallback used here (behavior-equivalent, per the brief's
 * note): one schedule on an internal `scrape-sweep` queue, 3×/day, whose
 * handler re-reads the enabled sources and `boss.send`s an individual
 * `scrape` job for each — fan-out happens at run time, not at schedule
 * registration time, so newly enabled sources are picked up automatically.
 */
export async function registerIngestionJobs(boss: PgBoss, pool: pg.Pool): Promise<void> {
  await boss.createQueue(SCRAPE)
  await boss.createQueue(PROCESS)
  await boss.createQueue(SCRAPE_SWEEP)
  const fetcher = createPoliteFetcher()
  const llm = createHaikuEnricher()

  await boss.work(SCRAPE, { batchSize: 1 }, async ([job]) => {
    const { sourceId } = job!.data as { sourceId: number }
    const r = await runScrape(pool, { fetcher }, sourceId)
    if (r.snapshotId !== null) await boss.send(PROCESS, { snapshotId: r.snapshotId, sourceId })
  })
  await boss.work(PROCESS, { batchSize: 1 }, async ([job]) => {
    await runProcess(pool, { llm }, job!.data as { snapshotId: number; sourceId: number })
  })
  await boss.work(SCRAPE_SWEEP, { batchSize: 1 }, async () => {
    const { rows: sources } = await pool.query(`SELECT id FROM sources WHERE enabled ORDER BY id`)
    for (const s of sources) await boss.send(SCRAPE, { sourceId: s.id })
  })

  // 3×/day (spec §5.2).
  await boss.schedule(SCRAPE_SWEEP, '0 6,14,22 * * *', {})
}
