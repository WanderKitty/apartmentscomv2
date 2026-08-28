import type pg from 'pg'
import type PgBoss from 'pg-boss'
import {
  createPoliteFetcher, parseRobots, entrataAdapter,
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

/** Stage 2 (spec §5.2). Returns { unchanged, snapshotId, runId }. Throws on fetch failure AFTER recording the failed run. */
export async function runScrape(
  pool: pg.Pool,
  deps: { fetcher: PoliteFetcher },
  sourceId: number,
): Promise<{ unchanged: boolean; snapshotId: number | null; runId: number }> {
  const source = await loadSource(pool, sourceId)
  const { rows: run } = await pool.query(
    `INSERT INTO scrape_runs (source_id) VALUES ($1) RETURNING id`, [sourceId],
  )
  const runId = run[0]!.id
  try {
    // Refresh robots policy once per run (cheap; cached in the sources row).
    // rate_limit_rps is a `numeric` column — pg returns it as a string.
    const maxRps = Number(source.rate_limit_rps)
    let policy = source.robots_policy
    try {
      const origin = new URL(source.website_url).origin
      const res = await deps.fetcher.fetchText(`${origin}/robots.txt`, null, { maxRps })
      if (res.status === 200) policy = parseRobots(res.body, 'aptv2-research-bot')
    } catch (e) {
      // Robots fetch failure keeps the stored policy — recorded below either way.
      console.warn(`[scrape] robots.txt refresh failed for source ${sourceId}, using stored policy:`, (e as Error).message)
    }
    // The adapter fetch MUST be gated by the policy we just refreshed, not
    // the stale row loaded above — otherwise a first-ever scrape (stored
    // policy null) runs ungated, and a newly published Disallow/Crawl-delay
    // is ignored for a full cycle.
    source.robots_policy = policy

    const snap = await entrataAdapter.fetch(source, deps.fetcher)
    // Only a FULLY processed prior snapshot licenses the short-circuit: a
    // 'partial' match means the last look at this exact content missed some
    // units, so identical content must be given another chance to extract
    // cleanly rather than being waved through as "already seen" (prod
    // incident 2026-08-28).
    const { rows: dup } = await pool.query(
      `SELECT id FROM raw_snapshots WHERE source_id = $1 AND content_hash = $2 AND processing_status = 'processed' LIMIT 1`,
      [sourceId, snap.content_hash],
    )
    const unchanged = dup.length > 0
    // Storage economy: an unchanged row is an audit marker, not a second
    // copy of the (potentially megabyte-sized) payload — it points at the
    // matched prior snapshot instead. Replay is unaffected: only
    // non-skipped rows are ever replayed.
    const storedPayload = unchanged ? { unchanged_ref: dup[0]!.id } : snap.payload
    const { rows: inserted } = await pool.query(
      `INSERT INTO raw_snapshots (source_id, content_hash, payload, processing_status)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [sourceId, snap.content_hash, JSON.stringify(storedPayload), unchanged ? 'skipped_unchanged' : 'pending'],
    )
    // hash short-circuit still confirms every active listing is live; the
    // confirmed count IS this run's listings_found — leaving it at the
    // default 0 makes the admin delta read as a phantom mass-delisting on
    // the (dominant) steady-state unchanged path.
    const confirmedCount = unchanged ? await bumpConfirmed(pool, sourceId, new Date()) : null
    await pool.query(
      `UPDATE sources SET last_scraped_at = now(), failure_streak = 0, robots_policy = $2 WHERE id = $1`,
      [sourceId, policy === null ? null : JSON.stringify(policy)],
    )
    await pool.query(
      `UPDATE scrape_runs SET finished_at = now(), status = 'ok', listings_found = COALESCE($2, listings_found) WHERE id = $1`,
      [runId, confirmedCount],
    )
    return { unchanged, snapshotId: unchanged ? null : inserted[0]!.id, runId }
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
  data: { snapshotId: number; sourceId: number; runId: number },
): Promise<{ upserted: number; failures: number }> {
  const source = await loadSource(pool, data.sourceId)
  const { rows: snaps } = await pool.query(`SELECT id, source_id, payload FROM raw_snapshots WHERE id = $1`, [data.snapshotId])
  if (!snaps[0]) throw new Error(`snapshot ${data.snapshotId} missing`)
  try {
    const { units, failures } = await extractSnapshot(pool, {
      snapshot: snaps[0], source, now: new Date(), llm: deps.llm,
    })
    await upsertProcessedUnits(pool, units, { sourceRef: data.sourceId })

    // A snapshot with any extraction failures (or zero extracted units) is
    // an incomplete view of what's really live — sweeping against it would
    // stale/gone listings that simply failed to parse THIS cycle, not
    // listings that actually vanished from the source.
    if (failures.length > 0 || units.length === 0) {
      console.warn(
        `[process] skipping sweepVanished for source ${data.sourceId}: ` +
        (failures.length > 0 ? `${failures.length} extraction failure(s)` : 'zero units extracted'),
      )
    } else {
      await sweepVanished(pool, data.sourceId, units.map((u) => u.collapse_key))
    }

    // 'partial' (not 'processed') when any unit failed: the unchanged-hash
    // short-circuit in runScrape only trusts a fully 'processed' snapshot,
    // so identical content gets reprocessed until it extracts cleanly.
    await pool.query(
      `UPDATE raw_snapshots SET processing_status = $2 WHERE id = $1`,
      [data.snapshotId, failures.length > 0 ? 'partial' : 'processed'],
    )

    // listings_changed isn't computed yet (no change-detection pass exists)
    // — always 0 for now. listings_found is the count of
    // units this cycle successfully extracted (and upserted), regardless
    // of failures.
    if (failures.length > 0) {
      const summary = `${failures.length} unit(s) failed extraction: ${failures.map((f) => f.externalId).join(', ')}`
      await pool.query(
        `UPDATE scrape_runs SET listings_found = $2, listings_changed = 0, status = 'partial', error = $3 WHERE id = $1`,
        [data.runId, units.length, summary],
      )
      console.error(`[process] ${summary}`)
    } else {
      // Explicit 'ok' (not just left over from the fetch stage) so a
      // pg-boss retry that later succeeds wins the status back from a
      // 'failed' left by an earlier crashed attempt.
      await pool.query(
        `UPDATE scrape_runs SET listings_found = $2, listings_changed = 0, status = 'ok' WHERE id = $1`,
        [data.runId, units.length],
      )
    }

    return { upserted: units.length, failures: failures.length }
  } catch (e) {
    await pool.query(
      `UPDATE raw_snapshots SET processing_status = 'failed', error = $2 WHERE id = $1`,
      [data.snapshotId, (e as Error).message],
    )
    // A whole-snapshot crash (e.g. payload shape error) must not leave the
    // run row 'ok' from the fetch stage — the admin page would say
    // everything is fine while processing silently failed.
    await pool.query(
      `UPDATE scrape_runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`,
      [data.runId, (e as Error).message],
    )
    await pool.query(`UPDATE sources SET failure_streak = failure_streak + 1 WHERE id = $1`, [data.sourceId])
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
    if (r.snapshotId !== null) await boss.send(PROCESS, { snapshotId: r.snapshotId, sourceId, runId: r.runId })
  })
  await boss.work(PROCESS, { batchSize: 1 }, async ([job]) => {
    await runProcess(pool, { llm }, job!.data as { snapshotId: number; sourceId: number; runId: number })
  })
  await boss.work(SCRAPE_SWEEP, { batchSize: 1 }, async () => {
    const { rows: sources } = await pool.query(`SELECT id FROM sources WHERE enabled ORDER BY id`)
    for (const s of sources) await boss.send(SCRAPE, { sourceId: s.id })
  })

  // 3×/day (spec §5.2).
  await boss.schedule(SCRAPE_SWEEP, '0 6,14,22 * * *', {})
}
