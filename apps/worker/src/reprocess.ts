// Enrichment backfill: re-run extraction over each source's LATEST stored
// snapshot with the LLM enricher attached. The unchanged-hash short-circuit
// means a normal scrape NEVER re-visits content that hasn't changed — so
// listings that landed during a keyless era keep not_mentioned LLM fields
// forever unless this pass runs. extract_cache makes it idempotent and
// cheap: the first keyed run pays the Haiku calls, every later run is a
// batched cache read.
//
// Tri-state exits (same convention as scrape-all):
//   0 — reprocessed N sources
//   1 — nothing to do (no eligible snapshots)
//   2 — cannot run (no ANTHROPIC_API_KEY — enrichment is the entire point)

import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { getPool, closePool } from '@aptv2/db'
import { createHaikuEnricher } from '@aptv2/pipeline'
import { runProcess } from './jobs/scrape'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

const llm = createHaikuEnricher()
if (!llm) {
  console.error('[reprocess] ANTHROPIC_API_KEY missing — enrichment is the entire point of this pass. Aborting.')
  process.exit(2)
}

const pool = getPool()
// Latest snapshot per source, only ones already fully or partially
// processed (pending/failed ones belong to the normal worker path; failed
// snapshots have nothing trustworthy to re-extract — spec §5).
const { rows } = await pool.query<{ id: number; source_id: number; content_hash: string }>(`
  SELECT DISTINCT ON (source_id) id, source_id, content_hash
  FROM raw_snapshots
  WHERE processing_status IN ('processed', 'partial')
  ORDER BY source_id, id DESC
`)

if (rows.length === 0) {
  console.log('[reprocess] no eligible snapshots — nothing to do')
  await closePool()
  process.exit(1)
}

console.log(`[reprocess] re-extracting ${rows.length} latest snapshot(s) with the Haiku enricher`)
let upserted = 0
let failures = 0
for (const r of rows) {
  // runProcess books its counts against a scrape_runs row; give each
  // reprocessed source its own run so the pass is visible in ops history
  // instead of silently overwriting the latest scrape's numbers.
  const { rows: run } = await pool.query<{ id: number }>(
    `INSERT INTO scrape_runs (source_id) VALUES ($1) RETURNING id`,
    [r.source_id],
  )
  const out = await runProcess(pool, { llm }, {
    snapshotId: r.id,
    sourceId: r.source_id,
    runId: run[0]!.id,
  })
  upserted += out.upserted
  failures += out.failures
  console.log(
    `[reprocess] source ${r.source_id} snapshot ${r.id} (${r.content_hash.slice(0, 12)}…): ` +
      `${out.upserted} upserted, ${out.failures} unit failure(s)`,
  )
}
console.log(`[reprocess] done: ${upserted} listings re-upserted, ${failures} unit failures`)
await closePool()
