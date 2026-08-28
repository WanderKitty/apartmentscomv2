import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { getPool } from '@aptv2/db'
import { createHaikuEnricher } from '@aptv2/pipeline'
import { createPoliteFetcher } from '@aptv2/scrapers'
import { runProcess, runScrape } from './jobs/scrape'
import { runScrapePool } from './scrape-pool'

// The entry point the hosted cron invokes instead of the long-lived
// pg-boss process: scrape every enabled source, then (if changed) process
// it, never letting one source's failure stop the rest. Sources run
// concurrently across hostnames (bounded by runScrapePool); same-host
// sources stay sequential so the politeness gate is never raced.

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

const pool = getPool()
const fetcher = createPoliteFetcher()
const llm = createHaikuEnricher()

const { rows: sources } = await pool.query<{ id: number; name: string; endpointUrl: string }>(
  `SELECT id, name, COALESCE(endpoint_config->>'endpoint_url', website_url) AS "endpointUrl"
   FROM sources WHERE enabled ORDER BY id`,
)

const { succeeded, failed } = await runScrapePool(sources, async (source) => {
  try {
    const scrape = await runScrape(pool, { fetcher }, source.id)
    if (scrape.snapshotId !== null) {
      const processed = await runProcess(pool, { llm }, { snapshotId: scrape.snapshotId, sourceId: source.id, runId: scrape.runId })
      console.log(`[scrape-all] ${source.name} (#${source.id}): unchanged=${scrape.unchanged} upserted=${processed.upserted} failures=${processed.failures}`)
    } else {
      console.log(`[scrape-all] ${source.name} (#${source.id}): unchanged=${scrape.unchanged}`)
    }
    return true
  } catch (e) {
    console.error(`[scrape-all] ${source.name} (#${source.id}) FAILED:`, (e as Error).message)
    return false
  }
})

console.log(`[scrape-all] done: ${succeeded} ok, ${failed} failed, ${sources.length} total`)
// Tri-state exit for CI cron: ANY source failure should alert, not just
// total failure. 0 = all ok, 2 = some failed, 1 = all failed.
process.exit(failed === 0 ? 0 : succeeded === 0 ? 1 : 2)
