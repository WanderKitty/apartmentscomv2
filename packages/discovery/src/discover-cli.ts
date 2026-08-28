import type pg from 'pg'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { z } from 'zod'
import { config } from 'dotenv'
import type { PoliteFetcher } from '@aptv2/scrapers'
import { verifyCandidate, type Candidate, type VerifyResult, type VerifyVerdict, type RobotsCache } from './verify'
import type { LlmFactsExtractor, GeocodeFn } from './facts'

// This file's own directory (packages/discovery/src) — used to pin the
// default report path to the package root regardless of the process's
// current working directory (review minor: `pnpm --filter` and a bare `tsx`
// invocation can have different CWDs).
const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))

// discover-cli (Task 6 runs this, supervised — NOT run in this task). Reads
// the candidates file, verifies them SEQUENTIALLY (one candidate's ≤4
// requests complete before the next candidate starts — never concurrent,
// per the compliance constraints), prints one progress line per candidate,
// and writes a full report (gitignored — see packages/discovery/candidates
// vs. this report's git status). Idempotent by website_url: re-running is
// safe because verifyCandidate's own upsert is ON CONFLICT (website_url) DO
// NOTHING.

const CandidateSchema = z.object({
  url: z.string().url(),
  metro: z.string().min(1),
  note: z.string().optional(),
})
const CandidatesFileSchema = z.array(CandidateSchema)

export type DiscoverCliDeps = {
  pool: pg.Pool
  fetcher: PoliteFetcher
  llm?: LlmFactsExtractor
  geocode?: GeocodeFn
  log?: (line: string) => void
  now?: () => Date
  /** Defaults to `discovery-report-<date>.json` in the current working directory. */
  reportPath?: string
}

export type DiscoverCliResult = {
  results: VerifyResult[]
  tally: Record<VerifyVerdict, number>
  reportPath: string
}

const ALL_VERDICTS: VerifyVerdict[] = [
  'registered',
  'not_entrata',
  'not_public',
  'unreachable',
  'no_endpoint',
  'no_facts',
  'out_of_scope',
]

export async function runDiscoverCli(candidatesPath: string, deps: DiscoverCliDeps): Promise<DiscoverCliResult> {
  const log = deps.log ?? ((line: string) => console.log(line))
  const now = deps.now ?? (() => new Date())
  const raw = JSON.parse(await readFile(candidatesPath, 'utf8'))
  const candidates: Candidate[] = CandidatesFileSchema.parse(raw)

  const results: VerifyResult[] = []
  const tally: Record<VerifyVerdict, number> = Object.fromEntries(ALL_VERDICTS.map((v) => [v, 0])) as Record<
    VerifyVerdict,
    number
  >
  // Shared across the whole run (review C1): N candidates on the same host
  // cost exactly ONE robots.txt fetch, not N.
  const robotsCache: RobotsCache = new Map()

  // Sequential by construction: each candidate is fully awaited (robots →
  // ... → up to 4 requests) before the next one starts.
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!
    const r = await verifyCandidate(candidate, deps.fetcher, {
      pool: deps.pool,
      llm: deps.llm,
      geocode: deps.geocode,
      robotsCache,
    })
    results.push(r)
    tally[r.verdict]++
    log(`[${i + 1}/${candidates.length}] ${r.url} -> ${r.verdict} (${r.detail})`)
  }

  const dateStr = now().toISOString().slice(0, 10)
  const reportPath = deps.reportPath ?? path.join(PACKAGE_DIR, `discovery-report-${dateStr}.json`)
  await writeFile(reportPath, JSON.stringify({ ranAt: now().toISOString(), tally, results }, null, 2))

  log(`Tally: ${JSON.stringify(tally)}`)
  const geocodedCount = results.filter((r) => r.detail.includes('geocoded=true')).length
  if (geocodedCount > 0) {
    log(
      `Reminder: Nominatim geocoding was used for ${geocodedCount} source(s) this run — "Geocoding data © OpenStreetMap contributors" attribution is already wired in the web footer and README.`,
    )
  }

  return { results, tally, reportPath }
}

// CLI entrypoint — only runs when this file is executed directly (`tsx
// src/discover-cli.ts <candidates-file>`), never when imported by tests.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })
  const { getPool, closePool } = await import('@aptv2/db')
  const { createHaikuFactsExtractor } = await import('./facts')
  const { createNominatimGeocoder } = await import('./geocode')
  const { createPoliteFetcher } = await import('@aptv2/scrapers')

  const candidatesArg = process.argv[2]
  if (!candidatesArg) {
    console.error('usage: discover-cli <candidates-file.json>')
    process.exit(1)
  }
  const pool = getPool()
  const result = await runDiscoverCli(candidatesArg, {
    pool,
    // retry429: false (review I3) — a rate-limited candidate site during a
    // first-contact verification probe must fail fast, not be hammered.
    fetcher: createPoliteFetcher({ retry429: false }),
    llm: createHaikuFactsExtractor() ?? undefined,
    geocode: createNominatimGeocoder(pool),
  })
  console.log(`Report written to ${result.reportPath}`)
  await closePool()
}
