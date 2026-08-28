import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { getPool } from '@aptv2/db'
import { createHaikuEnricher } from '@aptv2/pipeline'
import { createPoliteFetcher } from '@aptv2/scrapers'
import { runProcess, runScrape } from './jobs/scrape'

// The entry point a hosted cron (GitHub Actions, Plan 5) invokes instead of
// the long-lived pg-boss process: loop every enabled source, scrape then
// (if changed) process it, sequentially, never letting one source's
// failure stop the rest — each failure is already recorded in
// scrape_runs/failure_streak by runScrape/runProcess, so this CLI just
// logs and moves on.

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

const pool = getPool()
const fetcher = createPoliteFetcher()
const llm = createHaikuEnricher()

const { rows: sources } = await pool.query<{ id: number; name: string }>(
  `SELECT id, name FROM sources WHERE enabled ORDER BY id`,
)

let succeeded = 0
let failed = 0

for (const source of sources) {
  try {
    const scrape = await runScrape(pool, { fetcher }, source.id)
    if (scrape.snapshotId !== null) {
      const processed = await runProcess(pool, { llm }, { snapshotId: scrape.snapshotId, sourceId: source.id, runId: scrape.runId })
      console.log(`[scrape-all] ${source.name} (#${source.id}): unchanged=${scrape.unchanged} upserted=${processed.upserted} failures=${processed.failures}`)
    } else {
      console.log(`[scrape-all] ${source.name} (#${source.id}): unchanged=${scrape.unchanged}`)
    }
    succeeded++
  } catch (e) {
    console.error(`[scrape-all] ${source.name} (#${source.id}) FAILED:`, (e as Error).message)
    failed++
  }
}

console.log(`[scrape-all] done: ${succeeded} ok, ${failed} failed, ${sources.length} total`)
process.exit(succeeded === 0 && sources.length > 0 ? 1 : 0)
