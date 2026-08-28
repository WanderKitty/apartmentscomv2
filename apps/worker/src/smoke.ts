import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { closePool, getPool } from '@aptv2/db'
import { createHaikuEnricher } from '@aptv2/pipeline'
import { createPoliteFetcher, isPathAllowed } from '@aptv2/scrapers'
import { runProcess, runScrape } from './jobs/scrape'

// One-off manual scrape+process for a single source — the only networked
// path besides the scheduler. `pnpm --filter @aptv2/worker smoke -- --source <id>`

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

const sourceArgIdx = process.argv.indexOf('--source')
const sourceIdArg = sourceArgIdx >= 0 ? process.argv[sourceArgIdx + 1] : undefined
if (!sourceIdArg) throw new Error('usage: smoke.ts --source <id>')
const sourceId = Number(sourceIdArg)

const pool = getPool()
const fetcher = createPoliteFetcher()
const llm = createHaikuEnricher()

try {
  const scrape = await runScrape(pool, { fetcher }, sourceId)

  const { rows: srcRows } = await pool.query(
    `SELECT endpoint_config, robots_policy FROM sources WHERE id = $1`, [sourceId],
  )
  const src = srcRows[0]
  const endpointUrl: string = src.endpoint_config.endpoint_url
  const policy = src.robots_policy
  const decision = policy
    ? (isPathAllowed(policy, new URL(endpointUrl).pathname) ? 'allowed' : 'DISALLOWED')
    : 'no robots.txt policy stored (treated as allowed)'
  console.log(`[smoke] robots decision for ${endpointUrl}: ${decision}`)

  // id DESC (not fetched_at DESC) — id is the unambiguous monotonic order;
  // two snapshots can share a fetched_at timestamp.
  const { rows: snapRows } = await pool.query(
    `SELECT id, content_hash FROM raw_snapshots WHERE source_id = $1 ORDER BY id DESC LIMIT 1`, [sourceId],
  )
  const snap = snapRows[0]
  console.log(`[smoke] snapshot id=${snap.id} hash=${snap.content_hash} unchanged=${scrape.unchanged}`)

  if (scrape.snapshotId !== null) {
    const processed = await runProcess(pool, { llm }, { snapshotId: scrape.snapshotId, sourceId, runId: scrape.runId })
    console.log(`[smoke] processed: upserted=${processed.upserted} failures=${processed.failures}`)
  } else {
    console.log('[smoke] unchanged payload — nothing to process')
  }

  const { rows: top } = await pool.query(
    `SELECT u.name, u.beds, l.price_cents FROM listings l JOIN units u ON u.id = l.unit_id
     WHERE l.source_ref = $1 ORDER BY l.id DESC LIMIT 3`, [sourceId],
  )
  console.log('[smoke] top-3 listings:')
  for (const r of top) console.log(`  - ${r.name ?? '(unnamed)'} · ${r.beds ?? '?'} bed · ${r.price_cents ?? 'n/a'}c`)
  // The live pool otherwise holds the event loop open forever — exit explicitly.
  await closePool()
  process.exit(0)
} catch (e) {
  console.error('[smoke] FAILED:', (e as Error).message)
  process.exit(1)
}
