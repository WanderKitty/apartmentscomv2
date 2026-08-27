# Plan 4: Live Ingestion — RentCafe Adapter + Five-Stage Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real Orlando RentCafe listings flowing on a schedule through the spec's five-stage pipeline — politeness-compliant scraping into `raw_snapshots`, deterministic + Haiku extraction into `ProcessedUnitData`, the existing `upsertProcessedUnits` seam (amended so price history ACCUMULATES across runs instead of being overwritten), vanished-listing sweeps, `scrape_runs` ops records — surfaced in search results and a real `/admin` page.

**Architecture:** A new `packages/scrapers` owns the network edge: a shared politeness fetcher (robots.txt honored and cached, per-domain token bucket ≤1 req/s, identified User-Agent, exponential backoff) and a `rentcafe` adapter that hits the JSON endpoint each site's own frontend uses (endpoint recorded per source in `sources.endpoint_config`) and returns verbatim payloads. `packages/pipeline` grows the extract stage (`extractSnapshot`): deterministic field mapping first, then one fail-open Haiku structured-output call per *changed unit* — finer-grained than the spec's "per changed property" phrasing, deliberately: the cache key is a per-unit content hash in a new `extract_cache` table, so an unchanged unit never re-calls the model even when a sibling unit changed, feeding the existing upsert seam with `data_provenance: "scraped"`; plus the hash short-circuit (`bumpConfirmed`) and the stale→gone sweep. `apps/worker` schedules `scrape` per enabled source (3×/day, staggered) and processes snapshots with pg-boss retry + failure streaks. `apps/web` gets a real admin read model and a provenance-truthful results banner. Because the real payload shape is only knowable from a real site, Task 3 is an explicit scouting task: verify 3–5 genuinely public, robots-permissive RentCafe communities, capture ONE fixture payload, and reconcile the adapter mapping against it — tests never touch the network (spec §8).

**Tech Stack:** Existing monorepo — pnpm, Node ≥22, TS strict, pg 8, PostGIS, pg-boss 10, Vitest, Next 16.3.3. New code uses only existing deps plus `@anthropic-ai/sdk`/`zod` (already in `@aptv2/search`/`@aptv2/schema`); the robots.txt parser and token bucket are written in-repo (no new deps).

**Spec:** `docs/superpowers/specs/2026-08-27-apartment-aggregator-design.md` — §5 (five stages, politeness, error handling), §7 (compliance), §8 (ops/testing), §3.1 modules 2–3. Plan 3 (`docs/superpowers/plans/2026-08-27-plan-3-postgres-search.md`) built the serving side this plan feeds.

## Global Constraints

- Work in the main checkout `X:\apartmentscomv2`. Integration branch `plan4-integration` off `master`; task branches `task/p4-<n>-<slug>` off it, merged back `--no-ff` after review. Master merge only at the end, if green (controller decision; standing user ruling "merge to master at the end if green").
- pnpm only. Postgres must be up for DB tests (`docker compose up -d`; `TEST_DATABASE_URL` from root `.env`; `resetTestDb`; `fileParallelism: false` in DB-touching vitest configs).
- **Compliance (spec §7, binding):** scrape only publicly accessible pages/endpoints; never behind a login; never accept ToS to reach data. Honor robots.txt including crawl-delay; ≤1 req/sec per domain (slower if robots says). User-Agent is exactly `aptv2-research-bot/0.1 (+mailto:volodolzh@gmail.com)` (contact consented by the user 2026-08-27, with the explicit acknowledgment that this address will appear in every scraped site's server logs; used ONLY in the outbound UA header — never in any other request field, page, or log shipped off-machine; swapping to an alias is a one-line change in `politeness.ts` if the user later prefers one). Photos/marketing copy are linked, never rehosted; verbatim payloads live only in `raw_snapshots`.
- **Network discipline:** automated tests NEVER hit the network — adapters and extract are tested from checked-in fixture JSON (spec §8). The only networked paths are the scheduled worker jobs and the manual smoke command, and both go through the politeness fetcher. Scouting (Task 3) uses the implementer's browser/curl at human pace against public pages only.
- **Framing constraints (all user-facing copy):** describe competitor findings as "studied public payloads from my own browsing session"; never name or hint at any site's anti-bot measures; phrase their pipeline as inference. No hiring.cafe-derived strings except the existing homage field names.
- **Error handling (spec §5):** fail loudly and partially. One property's malformed data fails that property only — counted in `scrape_runs`, never silently skipped. No catch-and-continue without a counted, visible record. The single pre-existing sanctioned silent catch (search_logs) stays as-is.
- Extraction model is `claude-haiku-4-5`; the Anthropic key is server/worker-only and extraction is fail-open: with no key or on any error, LLM-enriched fields stay at their `not_mentioned` defaults and the listing still lands.
- Prices integer cents in DB/schema; dollars only in the UI mapper. Scraped records carry `data_provenance: "scraped"`, `platform: "rentcafe"`, `source_id` `rentcafe___<external>`, `collapse_key` `rentcafe:<external>`.
- Base tsconfig has `noUncheckedIndexedAccess: true` — minimal `!` on guarded index accesses is sanctioned; list every site in the task report.
- `apps/web` typecheck script stays `next typegen && tsc --noEmit`. Next 16: consult `apps/web/node_modules/next/dist/docs/` before touching `app/` routes.
- This is Windows; plan commands are bash — implementers use the Bash tool (`X:/apartmentscomv2` = `/x/apartmentscomv2`).
- **Out of scope (deferred, do not build):** the discovery/fingerprinting module (§5.1 — sources are hand-scouted in Task 3), `review_queue` population, email alerts and the nightly staleness sweep (§5.5/§8 ops follow-up), the AppFolio adapter, pagination UI beyond the LIMIT safety valve.
- End every commit message (including merges) with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Migration 0006 — source_ref, collapse_key NOT NULL, extract_cache

**Files:**
- Create: `packages/db/migrations/0006_ingestion_fields.sql`
- Test: `packages/db/test/schema-ingestion.test.ts`

**Interfaces:**
- Consumes: migrations 0001–0005 (`sources`, `raw_snapshots`, `listings`).
- Produces: `listings.source_ref int REFERENCES sources(id)` (nullable; seed rows stay null), `listings.collapse_key` NOT NULL, table `extract_cache(content_hash text PRIMARY KEY, extracted jsonb NOT NULL, created_at timestamptz)`. Tasks 4–5 write/read exactly these.

- [ ] **Step 1: Branches**

```bash
cd X:/apartmentscomv2
git checkout master && git checkout -b plan4-integration
git checkout -b task/p4-1-migration-0006
```

- [ ] **Step 2: Write the failing test**

`packages/db/test/schema-ingestion.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '../src/test-helpers.js'

let pool: Pool
let sourceId: number
let unitId: number
let propertyId: number

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await resetTestDb(pool)
  const { rows: s } = await pool.query(
    `INSERT INTO sources (platform, name, website_url)
     VALUES ('rentcafe', 'Test Community', 'https://example.com/test') RETURNING id`,
  )
  sourceId = s[0].id
  const { rows: p } = await pool.query(
    `INSERT INTO properties (name, address_line1, city, state, zip, normalized_address, location)
     VALUES ('Test Community', '1 Test St', 'Orlando', 'FL', '32801',
             '1 test st orlando fl 32801', ST_GeogFromText('POINT(-81.38 28.54)'))
     RETURNING id`,
  )
  propertyId = p[0].id
  const { rows: u } = await pool.query(
    `INSERT INTO units (property_id, kind, external_id, beds, baths)
     VALUES ($1, 'unit', '101', 1, 1) RETURNING id`,
    [propertyId],
  )
  unitId = u[0].id
})
afterAll(async () => {
  await pool.end()
})

describe('migration 0006 ingestion fields', () => {
  it('accepts a listing with source_ref and rejects one without collapse_key', async () => {
    const { rows } = await pool.query(
      `INSERT INTO listings (unit_id, property_id, collapse_key, source_ref)
       VALUES ($1, $2, 'rentcafe:test-101', $3) RETURNING source_ref`,
      [unitId, propertyId, sourceId],
    )
    expect(rows[0].source_ref).toBe(sourceId)
    await expect(
      pool.query(`INSERT INTO listings (unit_id, property_id) VALUES ($1, $2)`, [unitId, propertyId]),
    ).rejects.toThrow(/collapse_key/)
  })

  it('extract_cache stores and conflicts on content_hash', async () => {
    await pool.query(
      `INSERT INTO extract_cache (content_hash, extracted) VALUES ('abc123', '{"pets_allowed":"allowed"}')`,
    )
    await pool.query(
      `INSERT INTO extract_cache (content_hash, extracted) VALUES ('abc123', '{"pets_allowed":"cats_only"}')
       ON CONFLICT (content_hash) DO NOTHING`,
    )
    const { rows } = await pool.query(`SELECT extracted FROM extract_cache WHERE content_hash = 'abc123'`)
    expect(rows[0].extracted.pets_allowed).toBe('allowed')
  })
})
```

Run in `packages/db/`: `pnpm test -- test/schema-ingestion.test.ts` → FAIL (`column "source_ref" ... does not exist`).

- [ ] **Step 3: Write the migration**

`packages/db/migrations/0006_ingestion_fields.sql`:

```sql
-- Ingestion wiring: listings gain a source pointer for per-source sweeps
-- and admin counts; collapse_key becomes the enforced upsert identity
-- (every existing row was written with one by @aptv2/pipeline);
-- extract_cache memoizes per-property LLM extraction by content hash
-- (spec §5.3: "Results cached by content hash").
ALTER TABLE listings
  ADD COLUMN source_ref int REFERENCES sources(id),
  ALTER COLUMN collapse_key SET NOT NULL;

CREATE INDEX listings_source_ref ON listings (source_ref) WHERE source_ref IS NOT NULL;

CREATE TABLE extract_cache (
  content_hash text PRIMARY KEY,
  extracted    jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 4: GREEN + full db suite**

Run in `packages/db/`: `pnpm test` → all pass (existing suites insert listings with collapse_key already; if any old test inserts a listing WITHOUT collapse_key, fix that test to include one — that is the point of the constraint).

- [ ] **Step 5: Commit and merge**

```bash
git add packages/db
git commit -m "feat: migration 0006 - source_ref, collapse_key NOT NULL, extract_cache"
git checkout plan4-integration && git merge --no-ff task/p4-1-migration-0006
```

---

### Task 2: `packages/scrapers` — politeness fetcher + adapter seam

**Files:**
- Create: `packages/scrapers/package.json`, `packages/scrapers/tsconfig.json`, `packages/scrapers/vitest.config.ts`, `packages/scrapers/src/index.ts`, `packages/scrapers/src/types.ts`, `packages/scrapers/src/robots.ts`, `packages/scrapers/src/politeness.ts`
- Test: `packages/scrapers/src/robots.test.ts`, `packages/scrapers/src/politeness.test.ts`

**Interfaces:**
- Consumes: nothing outside Node built-ins.
- Produces (Tasks 4–5 consume exactly these):
  - `USER_AGENT = "aptv2-research-bot/0.1 (+mailto:volodolzh@gmail.com)"`
  - `parseRobots(txt: string, userAgent: string): RobotsPolicy` where `RobotsPolicy = { disallow: string[]; crawlDelaySeconds: number | null }`
  - `isPathAllowed(policy: RobotsPolicy, path: string): boolean`
  - `createPoliteFetcher(opts?: { fetchImpl?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void>; maxRps?: number }): PoliteFetcher` with `PoliteFetcher = { fetchJson(url: string, policy: RobotsPolicy | null): Promise<{ status: number; body: unknown }>; fetchText(url: string, policy: RobotsPolicy | null): Promise<{ status: number; body: string }> }` — both methods share ONE politeness path (robots check, per-domain token bucket at default 1 req/s or slower when `crawlDelaySeconds` is larger, `RobotsDisallowedError` thrown before any disallowed request is sent, 5xx/429 retried with exponential backoff 3 tries max, `USER_AGENT` always sent); they differ only in body handling (parsed JSON vs raw text — `fetchText` exists for robots.txt).
  - `type SourceRow = { id: number; platform: string; name: string; website_url: string; endpoint_config: { endpoint_url: string; property: { name: string; address_line1: string; city: string; state: string; zip: string; latitude: number; longitude: number } }; robots_policy: RobotsPolicy | null; rate_limit_rps: number }`
  - `type RawSnapshotInput = { source_id: number; content_hash: string; payload: unknown }`
  - `type Adapter = { platform: string; fetch(source: SourceRow, fetcher: PoliteFetcher): Promise<RawSnapshotInput> }` — one snapshot per source per run (the whole availability feed, verbatim).
  - `sha256Json(value: unknown): string` (stable stringify then hash — sort object keys recursively so hash equality means content equality).

- [ ] **Step 1: Branch and scaffold**

```bash
git checkout plan4-integration && git checkout -b task/p4-2-scrapers-seam
```

`packages/scrapers/package.json`:

```json
{
  "name": "@aptv2/scrapers",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/scrapers/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src"]
}
```

`packages/scrapers/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {},
})
```

Run `pnpm install` at root.

- [ ] **Step 2: Failing robots tests**

`packages/scrapers/src/robots.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isPathAllowed, parseRobots } from './robots'

const TXT = `
User-agent: *
Disallow: /admin/
Disallow: /private
Crawl-delay: 5

User-agent: aptv2-research-bot
Disallow: /noapt/
Crawl-delay: 2
`

describe('parseRobots', () => {
  it('prefers the specific user-agent group over *', () => {
    const p = parseRobots(TXT, 'aptv2-research-bot/0.1 (+mailto:volodolzh@gmail.com)')
    expect(p.disallow).toEqual(['/noapt/'])
    expect(p.crawlDelaySeconds).toBe(2)
  })

  it('falls back to the * group', () => {
    const p = parseRobots(TXT, 'otherbot/1.0')
    expect(p.disallow).toEqual(['/admin/', '/private'])
    expect(p.crawlDelaySeconds).toBe(5)
  })

  it('empty or missing robots means everything allowed', () => {
    const p = parseRobots('', 'aptv2-research-bot')
    expect(p.disallow).toEqual([])
    expect(p.crawlDelaySeconds).toBeNull()
    expect(isPathAllowed(p, '/anything')).toBe(true)
  })
})

describe('isPathAllowed', () => {
  const p = parseRobots(TXT, 'otherbot')
  it('blocks prefix matches and allows the rest', () => {
    expect(isPathAllowed(p, '/admin/x')).toBe(false)
    expect(isPathAllowed(p, '/privateer')).toBe(false) // prefix match per robots convention
    expect(isPathAllowed(p, '/public/feed.json')).toBe(true)
  })
})
```

Run: `pnpm --filter @aptv2/scrapers test` → FAIL (module missing).

- [ ] **Step 3: Implement robots.ts**

`packages/scrapers/src/robots.ts`:

```ts
// Minimal robots.txt parser (spec §7): user-agent groups, Disallow
// prefixes, Crawl-delay. The bot token (text before "/") selects the
// most specific matching group; "*" is the fallback.

export type RobotsPolicy = {
  disallow: string[]
  crawlDelaySeconds: number | null
}

export function parseRobots(txt: string, userAgent: string): RobotsPolicy {
  const botToken = userAgent.split('/')[0]!.trim().toLowerCase()
  type Group = { agents: string[]; disallow: string[]; crawlDelay: number | null }
  const groups: Group[] = []
  let current: Group | null = null
  let lastLineWasAgent = false
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const field = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (field === 'user-agent') {
      if (!lastLineWasAgent || !current) {
        current = { agents: [], disallow: [], crawlDelay: null }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastLineWasAgent = true
      continue
    }
    lastLineWasAgent = false
    if (!current) continue
    if (field === 'disallow' && value) current.disallow.push(value)
    if (field === 'crawl-delay') {
      const n = Number(value)
      if (Number.isFinite(n)) current.crawlDelay = n
    }
  }
  const specific = groups.find((g) => g.agents.some((a) => a !== '*' && botToken.includes(a)))
  const wildcard = groups.find((g) => g.agents.includes('*'))
  const chosen = specific ?? wildcard
  return {
    disallow: chosen?.disallow ?? [],
    crawlDelaySeconds: chosen?.crawlDelay ?? null,
  }
}

export function isPathAllowed(policy: RobotsPolicy, path: string): boolean {
  return !policy.disallow.some((prefix) => path.startsWith(prefix))
}
```

Run: robots tests GREEN.

- [ ] **Step 4: Failing politeness tests**

`packages/scrapers/src/politeness.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { RobotsDisallowedError, createPoliteFetcher, USER_AGENT, sha256Json } from './index'
import { parseRobots } from './robots'

function fakeFetch(responses: Array<{ status: number; body?: unknown }>) {
  let i = 0
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> })
    const r = responses[Math.min(i++, responses.length - 1)]!
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    })
  })
  return { impl: impl as unknown as typeof fetch, calls }
}

describe('createPoliteFetcher', () => {
  it('sends the identified User-Agent and parses JSON', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { ok: 1 } }])
    const f = createPoliteFetcher({ fetchImpl: impl, sleep: async () => {} })
    const r = await f.fetchJson('https://example.com/feed.json', null)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: 1 })
    expect(calls[0]!.headers['user-agent']).toBe(USER_AGENT)
  })

  it('refuses a robots-disallowed path without sending anything', async () => {
    const { impl } = fakeFetch([{ status: 200 }])
    const f = createPoliteFetcher({ fetchImpl: impl, sleep: async () => {} })
    const policy = parseRobots('User-agent: *\nDisallow: /feed', USER_AGENT)
    await expect(f.fetchJson('https://example.com/feed.json', policy)).rejects.toBeInstanceOf(
      RobotsDisallowedError,
    )
    expect(impl).not.toHaveBeenCalled()
  })

  it('spaces same-domain requests to the rate limit', async () => {
    const sleeps: number[] = []
    let clock = 0
    const { impl } = fakeFetch([{ status: 200 }, { status: 200 }])
    const f = createPoliteFetcher({
      fetchImpl: impl,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms)
        clock += ms
      },
    })
    await f.fetchJson('https://example.com/a', null)
    await f.fetchJson('https://example.com/b', null) // same domain, same instant → must wait ~1000ms
    expect(sleeps.some((ms) => ms >= 999)).toBe(true)
  })

  it('honors a crawl-delay larger than the default spacing', async () => {
    const sleeps: number[] = []
    let clock = 0
    const { impl } = fakeFetch([{ status: 200 }, { status: 200 }])
    const f = createPoliteFetcher({
      fetchImpl: impl,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms)
        clock += ms
      },
    })
    const policy = parseRobots('User-agent: *\nCrawl-delay: 5', USER_AGENT)
    await f.fetchJson('https://example.com/a', policy)
    await f.fetchJson('https://example.com/b', policy)
    expect(sleeps.some((ms) => ms >= 4999)).toBe(true)
  })

  it('retries 5xx with backoff then succeeds; gives up after 3 tries', async () => {
    const { impl } = fakeFetch([{ status: 503 }, { status: 503 }, { status: 200, body: { ok: 1 } }])
    const f = createPoliteFetcher({ fetchImpl: impl, sleep: async () => {} })
    const r = await f.fetchJson('https://example.com/flaky', null)
    expect(r.status).toBe(200)

    const always503 = fakeFetch([{ status: 503 }])
    const g = createPoliteFetcher({ fetchImpl: always503.impl, sleep: async () => {} })
    await expect(g.fetchJson('https://example.com/dead', null)).rejects.toThrow(/503/)
    expect(always503.impl).toHaveBeenCalledTimes(3)
  })
})

describe('fetchText', () => {
  it('shares the politeness path and returns raw text', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> })
      return new Response('User-agent: *\nDisallow: /x', { status: 200, headers: { 'content-type': 'text/plain' } })
    }) as unknown as typeof fetch
    const f = createPoliteFetcher({ fetchImpl: impl, sleep: async () => {} })
    const r = await f.fetchText('https://example.com/robots.txt', null)
    expect(r.status).toBe(200)
    expect(r.body).toContain('Disallow: /x')
    expect(calls[0]!.headers['user-agent']).toBe(USER_AGENT)
  })

  it('refuses a robots-disallowed path just like fetchJson', async () => {
    const impl = vi.fn() as unknown as typeof fetch
    const f = createPoliteFetcher({ fetchImpl: impl, sleep: async () => {} })
    const policy = parseRobots('User-agent: *\nDisallow: /secret', USER_AGENT)
    await expect(f.fetchText('https://example.com/secret.txt', policy)).rejects.toBeInstanceOf(
      RobotsDisallowedError,
    )
    expect(impl).not.toHaveBeenCalled()
  })
})

describe('sha256Json', () => {
  it('is stable under key order', () => {
    expect(sha256Json({ a: 1, b: [2, { c: 3, d: 4 }] })).toBe(
      sha256Json({ b: [2, { d: 4, c: 3 }], a: 1 }),
    )
    expect(sha256Json({ a: 1 })).not.toBe(sha256Json({ a: 2 }))
  })
})
```

Run → FAIL (exports missing).

- [ ] **Step 5: Implement politeness.ts, types.ts, index.ts**

`packages/scrapers/src/politeness.ts`:

```ts
import { createHash } from 'node:crypto'
import { isPathAllowed, type RobotsPolicy } from './robots'

// Politeness is enforced centrally (spec §5.2): adapters cannot reach the
// network except through this fetcher.

export const USER_AGENT = 'aptv2-research-bot/0.1 (+mailto:volodolzh@gmail.com)'

export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`robots.txt disallows ${url}`)
    this.name = 'RobotsDisallowedError'
  }
}

const stableStringify = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, val]) => `${JSON.stringify(k)}:${stableStringify(val)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(v)
}

export function sha256Json(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

export type PoliteFetcher = {
  fetchJson(url: string, policy: RobotsPolicy | null): Promise<{ status: number; body: unknown }>
  fetchText(url: string, policy: RobotsPolicy | null): Promise<{ status: number; body: string }>
}

export function createPoliteFetcher(
  opts: {
    fetchImpl?: typeof fetch
    now?: () => number
    sleep?: (ms: number) => Promise<void>
    maxRps?: number
  } = {},
): PoliteFetcher {
  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const minGapMs = 1000 / (opts.maxRps ?? 1)
  const lastRequestAt = new Map<string, number>()

  // ONE politeness path for every request kind: robots gate, per-domain
  // spacing, UA, retry with backoff. Body handling is the only variance.
  async function politeRequest(url: string, policy: RobotsPolicy | null): Promise<Response> {
    const u = new URL(url)
    if (policy && !isPathAllowed(policy, u.pathname)) throw new RobotsDisallowedError(url)
    const gapMs = Math.max(minGapMs, (policy?.crawlDelaySeconds ?? 0) * 1000)
    const last = lastRequestAt.get(u.hostname)
    if (last !== undefined) {
      const wait = last + gapMs - now()
      if (wait > 0) await sleep(wait)
    }
    let lastStatus = 0
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(1000 * 2 ** attempt) // exponential backoff
      lastRequestAt.set(u.hostname, now())
      const res = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT } })
      lastStatus = res.status
      if (res.status >= 500 || res.status === 429) continue
      return res
    }
    throw new Error(`fetch failed after 3 attempts (${lastStatus}): ${url}`)
  }

  return {
    async fetchJson(url, policy) {
      const res = await politeRequest(url, policy)
      const body = await res.json().catch(() => null)
      return { status: res.status, body }
    },
    async fetchText(url, policy) {
      const res = await politeRequest(url, policy)
      return { status: res.status, body: await res.text() }
    },
  }
}
```

`packages/scrapers/src/types.ts`:

```ts
import type { RobotsPolicy } from './robots'
import type { PoliteFetcher } from './politeness'

/** One row of the sources registry, as the worker reads it. */
export type SourceRow = {
  id: number
  platform: string
  name: string
  website_url: string
  endpoint_config: {
    /** The JSON endpoint this site's own frontend uses, found at scouting. */
    endpoint_url: string
    /** Property facts recorded at scouting (payloads rarely carry full address/geo). */
    property: {
      name: string
      address_line1: string
      city: string
      state: string
      zip: string
      latitude: number
      longitude: number
    }
  }
  robots_policy: RobotsPolicy | null
  rate_limit_rps: number
}

export type RawSnapshotInput = {
  source_id: number
  content_hash: string
  payload: unknown
}

/** One adapter per platform (spec §3.1): verbatim payloads, no business logic. */
export type Adapter = {
  platform: string
  fetch(source: SourceRow, fetcher: PoliteFetcher): Promise<RawSnapshotInput>
}
```

`packages/scrapers/src/index.ts`:

```ts
export { parseRobots, isPathAllowed, type RobotsPolicy } from './robots'
export {
  USER_AGENT,
  RobotsDisallowedError,
  createPoliteFetcher,
  sha256Json,
  type PoliteFetcher,
} from './politeness'
export type { Adapter, RawSnapshotInput, SourceRow } from './types'
```

Run: `pnpm --filter @aptv2/scrapers test` → all green. `pnpm -r typecheck` clean.

- [ ] **Step 6: Commit and merge**

```bash
git add packages/scrapers pnpm-lock.yaml
git commit -m "feat: @aptv2/scrapers politeness fetcher, robots parser, adapter seam"
git checkout plan4-integration && git merge --no-ff task/p4-2-scrapers-seam
```

---

### Task 3: Scout real Orlando RentCafe sources + capture the fixture

This task produces DATA and EVIDENCE, not logic: a curated `sources` seed and one checked-in fixture payload the adapter (Task 4) is built against. It requires human-paced browsing of public pages — no automated crawling.

**Files:**
- Create: `packages/scrapers/fixtures/rentcafe-availability.json` (one captured verbatim payload), `packages/scrapers/fixtures/README.md` (provenance + capture date), `packages/pipeline/src/sources-seed.ts`, `packages/pipeline/src/seed-sources-cli.ts`
- Modify: `packages/pipeline/package.json` (script `"seed:sources": "tsx src/seed-sources-cli.ts"`)
- Test: `packages/pipeline/test/sources-seed.test.ts`

**Interfaces:**
- Consumes: `SourceRow['endpoint_config']` shape from Task 2.
- Produces: `SOURCES_SEED: Array<{ platform: 'rentcafe'; name: string; website_url: string; endpoint_config: SourceRow['endpoint_config']; rate_limit_rps: number }>` (3–5 entries) and `seedSources(pool): Promise<number>` (upsert by `website_url`). Task 5's worker reads these rows.

- [ ] **Step 1: Branch**

```bash
git checkout plan4-integration && git checkout -b task/p4-3-scout-sources
```

- [ ] **Step 2: Scout candidates (manual, public pages only)**

Find 3–5 Orlando apartment communities whose sites are RentCafe-hosted, using spec §5.1's fingerprints: pages referencing `api.rentcafe.com` or hosted on `*.securecafe.com`, RentCafe availability widgets. Method (human-paced, via WebFetch/curl of public pages or the implementer's browser tooling):
1. Web-search for Orlando apartment communities; open candidate property sites.
2. For each candidate, confirm: (a) publicly accessible with no login; (b) the availability/floorplan page is driven by a JSON endpoint (inspect page source / network for the fingerprints above); (c) `GET {site}/robots.txt` does NOT disallow the relevant paths for `*` or our bot token — record the robots.txt text verbatim in the task report; (d) note the JSON endpoint URL the site's own frontend calls.
3. Record for each accepted source: community name, website URL, endpoint URL, street address, city/state/zip, and lat/lng (from the address via any public map view — recorded by hand, not scraped).
4. STOP-rule: if a candidate requires accepting ToS, solving a challenge, or logging in to see availability — skip it and say so in the report. Do not work around anything. If fewer than 3 clean candidates emerge after ~10 checked, report DONE_WITH_CONCERNS with what was found; the plan proceeds with as few as 1.

- [ ] **Step 3: Capture ONE fixture payload**

From the FIRST accepted source, fetch its endpoint URL once (single request, browser or curl, normal headers) and save the verbatim JSON response as `packages/scrapers/fixtures/rentcafe-availability.json`. Write `packages/scrapers/fixtures/README.md`: which source, capture timestamp, the single-request method, and the sentence "Captured once from a public endpoint during scouting; used only as a test fixture (spec §8: no network in tests)." Do NOT capture photos or any binary assets.

- [ ] **Step 4: Failing seed test, then implement**

`packages/pipeline/test/sources-seed.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '@aptv2/db/test-helpers'
import { SOURCES_SEED, seedSources } from '../src/sources-seed'

let pool: Pool
beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await resetTestDb(pool)
})
afterAll(async () => {
  await pool.end()
})

describe('sources seed', () => {
  it('has 1-5 rentcafe sources with complete endpoint_config', () => {
    expect(SOURCES_SEED.length).toBeGreaterThanOrEqual(1)
    expect(SOURCES_SEED.length).toBeLessThanOrEqual(5)
    for (const s of SOURCES_SEED) {
      expect(s.platform).toBe('rentcafe')
      expect(s.endpoint_config.endpoint_url).toMatch(/^https:\/\//)
      const p = s.endpoint_config.property
      expect(p.city).toBe('Orlando')
      expect(p.latitude).toBeGreaterThan(27)
      expect(p.longitude).toBeLessThan(-80)
    }
  })

  it('seeds idempotently by website_url', async () => {
    const first = await seedSources(pool)
    expect(first).toBe(SOURCES_SEED.length)
    await seedSources(pool)
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM sources`)
    expect(rows[0].n).toBe(SOURCES_SEED.length)
  })
})
```

`packages/pipeline/src/sources-seed.ts` — the scouted data as a typed literal plus:

```ts
import type pg from 'pg'
import type { SourceRow } from '@aptv2/scrapers'

export const SOURCES_SEED: Array<{
  platform: 'rentcafe'
  name: string
  website_url: string
  endpoint_config: SourceRow['endpoint_config']
  rate_limit_rps: number
}> = [
  // Filled from Task 3 scouting — one entry per accepted community, e.g.:
  // {
  //   platform: 'rentcafe',
  //   name: '<community name>',
  //   website_url: 'https://<site>',
  //   endpoint_config: {
  //     endpoint_url: 'https://<the JSON endpoint the site frontend calls>',
  //     property: { name: '...', address_line1: '...', city: 'Orlando', state: 'FL', zip: '...', latitude: 28.x, longitude: -81.x },
  //   },
  //   rate_limit_rps: 1,
  // },
]

export async function seedSources(pool: pg.Pool): Promise<number> {
  let n = 0
  for (const s of SOURCES_SEED) {
    await pool.query(
      `INSERT INTO sources (platform, name, website_url, endpoint_config, rate_limit_rps)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (website_url) DO UPDATE SET
         name = EXCLUDED.name, endpoint_config = EXCLUDED.endpoint_config,
         rate_limit_rps = EXCLUDED.rate_limit_rps
       RETURNING id`,
      [s.platform, s.name, s.website_url, JSON.stringify(s.endpoint_config), s.rate_limit_rps],
    )
    n++
  }
  return n
}
```

(The commented example is a SHAPE for the implementer to fill with real scouted values — an empty `SOURCES_SEED` fails the first test, which is the RED state; filling it with the scouted entries is the GREEN step.)

`packages/pipeline/src/seed-sources-cli.ts` — same pattern as `seed-cli.ts`: dotenv root `.env`, `getPool`, `seedSources`, print count, `closePool`. Add `"seed:sources": "tsx src/seed-sources-cli.ts"` to `packages/pipeline/package.json`, plus `"@aptv2/scrapers": "workspace:*"` to its dependencies.

Run: tests GREEN; `pnpm --filter @aptv2/pipeline seed:sources` against the dev DB prints the count, twice, idempotent.

- [ ] **Step 5: Commit and merge**

```bash
git add packages/scrapers/fixtures packages/pipeline pnpm-lock.yaml
git commit -m "feat: scouted rentcafe sources seed + captured availability fixture"
git checkout plan4-integration && git merge --no-ff task/p4-3-scout-sources
```

---

### Task 4: RentCafe adapter + extract stage (deterministic + fail-open Haiku)

**Files:**
- Create: `packages/scrapers/src/rentcafe.ts`, `packages/scrapers/src/rentcafe.test.ts`
- Create: `packages/pipeline/src/extract.ts`, `packages/pipeline/test/extract.test.ts`
- Modify: `packages/scrapers/src/index.ts` (export adapter), `packages/pipeline/src/index.ts` (export extract), `packages/pipeline/package.json` (add `@anthropic-ai/sdk`, `zod`, `@aptv2/schema` if missing)

**Interfaces:**
- Consumes: `Adapter`, `SourceRow`, `PoliteFetcher`, `sha256Json` (Task 2); the captured fixture (Task 3); `ProcessedUnitDataSchema`, `SOURCE_ID_SEPARATOR`, `minimalUnit`, `netEffectiveMonthlyCents`, `UNIT_AMENITIES`, `COMMUNITY_AMENITIES` from `@aptv2/schema`; `extract_cache` (Task 1).
- Produces:
  - `rentcafeAdapter: Adapter` — fetches `source.endpoint_config.endpoint_url` through the politeness fetcher (robots policy passed in by the caller) and returns `{ source_id, content_hash: sha256Json(payload), payload }`.
  - `parseRentcafePayload(payload: unknown): RentcafeUnit[]` where `RentcafeUnit = { externalId: string; floorplanName: string | null; unitNumber: string | null; beds: number; baths: number; sqft: number | null; rentCents: number | null; availableOn: string | null; amenityTexts: string[]; marketingTexts: string[]; detailUrl: string | null }` — pure, throws `RentcafePayloadError` naming the missing field when the payload shape is wrong.
  - `extractSnapshot(pool, args: { snapshot: { id: number; source_id: number; payload: unknown }; source: SourceRow; now: Date; llm?: LlmEnricher | null }): Promise<{ units: ProcessedUnitData[]; failures: Array<{ externalId: string; error: string }> }>` — per-unit try/catch: one bad unit lands in `failures` (counted), the rest proceed. `LlmEnricher = (texts: string[]) => Promise<LlmEnrichment | null>`; `createHaikuEnricher(): LlmEnricher | null` returns null without `ANTHROPIC_API_KEY`.
- Task 5 calls `rentcafeAdapter.fetch` and `extractSnapshot` with exactly these signatures.

- [ ] **Step 1: Branch; write the failing adapter test against the FIXTURE**

```bash
git checkout plan4-integration && git checkout -b task/p4-4-adapter-extract
```

`packages/scrapers/src/rentcafe.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseRentcafePayload, rentcafeAdapter } from './rentcafe'
import type { PoliteFetcher, SourceRow } from './index'

const payload = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/rentcafe-availability.json', import.meta.url)), 'utf8'),
)

const SOURCE: SourceRow = {
  id: 7,
  platform: 'rentcafe',
  name: 'Fixture Community',
  website_url: 'https://example.com',
  endpoint_config: {
    endpoint_url: 'https://example.com/feed.json',
    property: {
      name: 'Fixture Community', address_line1: '1 Fixture St', city: 'Orlando',
      state: 'FL', zip: '32801', latitude: 28.54, longitude: -81.38,
    },
  },
  robots_policy: null,
  rate_limit_rps: 1,
}

describe('parseRentcafePayload (golden, from the captured fixture)', () => {
  const units = parseRentcafePayload(payload)

  it('parses at least one unit with sane fields', () => {
    expect(units.length).toBeGreaterThanOrEqual(1)
    for (const u of units) {
      expect(u.externalId).toBeTruthy()
      expect(u.beds).toBeGreaterThanOrEqual(0)
      expect(u.baths).toBeGreaterThanOrEqual(1)
      expect(u.rentCents === null || u.rentCents > 30000).toBe(true) // dollars→cents conversion sanity
    }
    expect(new Set(units.map((u) => u.externalId)).size).toBe(units.length)
  })

  it('throws a named error on a wrong-shaped payload', () => {
    expect(() => parseRentcafePayload({ nonsense: true })).toThrow(/Rentcafe/)
  })
})

describe('rentcafeAdapter', () => {
  it('fetches the configured endpoint through the injected fetcher, verbatim + hashed', async () => {
    const fetcher: PoliteFetcher = {
      fetchJson: async (url) => {
        expect(url).toBe('https://example.com/feed.json')
        return { status: 200, body: payload }
      },
    }
    const snap = await rentcafeAdapter.fetch(SOURCE, fetcher)
    expect(snap.source_id).toBe(7)
    expect(snap.payload).toEqual(payload)
    expect(snap.content_hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
```

Run → FAIL (module missing).

- [ ] **Step 2: Implement the adapter against the real fixture**

`packages/scrapers/src/rentcafe.ts` — the mapping is written by READING the captured fixture. The plan cannot know the exact key names in advance; the contract it fixes is `RentcafeUnit` (above) and these rules:
- Pure function, no network. Every field access is defensive: a missing REQUIRED field (external id, beds, baths) throws `RentcafePayloadError('missing <field> at <path>')`; missing optional fields map to null.
- Rent arrives in dollars in RentCafe payloads → multiply by 100 and round to integer cents; "Call for details"/absent → `rentCents: null`.
- `amenityTexts` and `marketingTexts` collect the payload's free-text strings (amenity lists, specials/description blurbs) verbatim for the extract stage — no interpretation here (adapters carry no business logic).
- `rentcafeAdapter.fetch` = one `fetcher.fetchJson(endpoint_url, source.robots_policy)` call; non-200 throws; returns the verbatim body + `sha256Json` hash.
- Export both from `index.ts`: `export { rentcafeAdapter, parseRentcafePayload, RentcafePayloadError, type RentcafeUnit } from './rentcafe'`.

Adjust the golden test's specific assertions to the fixture's actual content (unit count, one known external id) and STATE the observed values in the task report. Run → GREEN.

- [ ] **Step 3: Failing extract tests**

`packages/pipeline/test/extract.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '@aptv2/db/test-helpers'
import { ProcessedUnitDataSchema } from '@aptv2/schema'
import type { SourceRow } from '@aptv2/scrapers'
import { extractSnapshot } from '../src/extract'

const payload = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../scrapers/fixtures/rentcafe-availability.json', import.meta.url)),
    'utf8',
  ),
)
const NOW = new Date('2026-08-27T12:00:00.000Z')
const SOURCE: SourceRow = {
  id: 1, platform: 'rentcafe', name: 'Fixture Community', website_url: 'https://example.com',
  endpoint_config: {
    endpoint_url: 'https://example.com/feed.json',
    property: {
      name: 'Fixture Community', address_line1: '1 Fixture St', city: 'Orlando',
      state: 'FL', zip: '32801', latitude: 28.54, longitude: -81.38,
    },
  },
  robots_policy: null, rate_limit_rps: 1,
}

let pool: Pool
beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await resetTestDb(pool)
  const { rows } = await pool.query(
    `INSERT INTO sources (platform, name, website_url) VALUES ('rentcafe', 'Fixture Community', 'https://example.com') RETURNING id`,
  )
  SOURCE.id = rows[0].id
})
afterAll(async () => {
  await pool.end()
})

describe('extractSnapshot', () => {
  it('produces schema-valid scraped records without any LLM (fail-open)', async () => {
    const { units, failures } = await extractSnapshot(pool, {
      snapshot: { id: 1, source_id: SOURCE.id, payload },
      source: SOURCE, now: NOW, llm: null,
    })
    expect(failures).toEqual([])
    expect(units.length).toBeGreaterThanOrEqual(1)
    for (const u of units) {
      ProcessedUnitDataSchema.parse(u)
      expect(u.data_provenance).toBe('scraped')
      expect(u.platform).toBe('rentcafe')
      expect(u.source_id.startsWith('rentcafe___')).toBe(true)
      expect(u.pets_allowed).toBe('not_mentioned') // LLM-less fields stay honest
      expect(u.property_name).toBe('Fixture Community')
      expect(u.latitude).toBeCloseTo(28.54, 3)
    }
  })

  it('applies LLM enrichment when the enricher returns values, and caches by content hash', async () => {
    const enricher = vi.fn(async () => ({
      pets_allowed: 'allowed' as const,
      concession_text: '1 month free on 12-month leases',
      concession: { kind: 'free_months' as const, months: 1, leaseMonths: 12 },
      furnished: null,
      short_term_ok: null,
      summary: 'A fixture summary.',
    }))
    const first = await extractSnapshot(pool, {
      snapshot: { id: 2, source_id: SOURCE.id, payload },
      source: SOURCE, now: NOW, llm: enricher,
    })
    const enriched = first.units[0]!
    expect(enriched.pets_allowed).toBe('allowed')
    expect(enriched.concession_type).toBe('free_months')
    expect(enriched.net_effective_monthly_cents).not.toBeNull()

    const callsAfterFirst = enricher.mock.calls.length
    expect(callsAfterFirst).toBeGreaterThanOrEqual(1)
    // Second run over the SAME payload: served from extract_cache, no new calls.
    await extractSnapshot(pool, {
      snapshot: { id: 3, source_id: SOURCE.id, payload },
      source: SOURCE, now: NOW, llm: enricher,
    })
    expect(enricher.mock.calls.length).toBe(callsAfterFirst)
  })

  it('a throwing enricher degrades to not_mentioned instead of failing the unit', async () => {
    await pool.query('DELETE FROM extract_cache')
    const { units, failures } = await extractSnapshot(pool, {
      snapshot: { id: 4, source_id: SOURCE.id, payload },
      source: SOURCE, now: NOW,
      llm: async () => { throw new Error('api down') },
    })
    expect(failures).toEqual([])
    expect(units[0]!.pets_allowed).toBe('not_mentioned')
  })
})
```

Run → FAIL (module missing).

Fixture-content caveat: the enrichment assertions target `units[0]`, which assumes the fixture's FIRST unit carries non-empty `amenityTexts`/`marketingTexts` (the enricher is skipped for units with no free text). If the captured fixture's first unit has none, retarget the assertions at a unit that does (find its index and say so in the report); if NO unit in the fixture carries free text, keep the fixture-based deterministic tests as-is and run the enrichment/caching tests against a minimal synthesized payload variant (the fixture payload plus one injected marketing string) so the cache path is still genuinely exercised.

- [ ] **Step 4: Implement extract.ts**

`packages/pipeline/src/extract.ts` — structure (the deterministic mapping reuses `minimalUnit()` as the base exactly like the seed builder does):

```ts
import type pg from 'pg'
import {
  ProcessedUnitDataSchema,
  SOURCE_ID_SEPARATOR,
  minimalUnit,
  netEffectiveMonthlyCents,
  type Concession,
  type ProcessedUnitData,
} from '@aptv2/schema'
import { parseRentcafePayload, sha256Json, type SourceRow } from '@aptv2/scrapers'

// Stage 3 (spec §5.3): deterministic mapping first — no LLM for price /
// beds / baths / sqft / availability — then one enrichment call per
// CHANGED unit for genuinely unstructured text, cached by content hash.
// Fail-open: no key / any error → enriched fields stay not_mentioned.

export type LlmEnrichment = {
  pets_allowed: ProcessedUnitData['pets_allowed']
  concession_text: string | null
  concession: Concession | null
  furnished: ProcessedUnitData['furnished'] | null
  short_term_ok: boolean | null
  summary: string | null
}
export type LlmEnricher = (texts: string[]) => Promise<LlmEnrichment | null>

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

export async function extractSnapshot(
  pool: pg.Pool,
  args: {
    snapshot: { id: number; source_id: number; payload: unknown }
    source: SourceRow
    now: Date
    llm?: LlmEnricher | null
  },
): Promise<{ units: ProcessedUnitData[]; failures: Array<{ externalId: string; error: string }> }> {
  const { snapshot, source, now } = args
  const parsed = parseRentcafePayload(snapshot.payload) // shape error here fails the whole snapshot — correct: nothing is trustworthy
  const prop = source.endpoint_config.property
  const nowIso = now.toISOString()
  const units: ProcessedUnitData[] = []
  const failures: Array<{ externalId: string; error: string }> = []

  for (const ru of parsed) {
    try {
      const externalId = `${slug(prop.name)}-${slug(ru.externalId)}`
      const unitHash = sha256Json({ u: ru, v: 1 })
      const enrichment = await cachedEnrichment(pool, unitHash, args.llm ?? null, [
        ...ru.amenityTexts,
        ...ru.marketingTexts,
      ])
      const concession = enrichment?.concession ?? null
      const base = minimalUnit()
      const record: ProcessedUnitData = ProcessedUnitDataSchema.parse({
        ...base,
        source_id: `rentcafe${SOURCE_ID_SEPARATOR}${externalId}`,
        platform: 'rentcafe',
        collapse_key: `rentcafe:${externalId}`,
        liberal_dedup_cluster: `orlando:${slug(prop.address_line1)}-${slug(ru.unitNumber ?? ru.floorplanName ?? ru.externalId)}`,
        source_url: ru.detailUrl ?? source.website_url,
        data_provenance: 'scraped',
        scraped_at: nowIso,
        property_name: prop.name,
        address_line1: prop.address_line1,
        city: prop.city,
        state: prop.state,
        zip: prop.zip,
        neighborhood: '', // resolved spatially at upsert (Task 5 amendment)
        latitude: prop.latitude,
        longitude: prop.longitude,
        unit_number: ru.unitNumber,
        floorplan_name: ru.floorplanName,
        beds: ru.beds,
        baths: ru.baths,
        sqft: ru.sqft,
        is_sqft_not_mentioned: ru.sqft === null,
        advertised_rent_cents: ru.rentCents,
        is_rent_not_mentioned: ru.rentCents === null,
        price_level: ru.rentCents === null ? 'not_listed' : ru.unitNumber ? 'unit' : 'floorplan_starting_at',
        is_price_transparent: ru.rentCents !== null && ru.unitNumber !== null,
        ...(ru.rentCents !== null
          ? {
              rent_monthly_cents: ru.rentCents,
              rent_annual_cents: ru.rentCents * 12,
              rent_weekly_cents: Math.round((ru.rentCents * 12) / 52),
              rent_daily_cents: Math.round((ru.rentCents * 12) / 365),
            }
          : {}),
        concession_type: concession ? concession.kind : enrichment ? 'none' : 'not_mentioned',
        concession_text_raw: enrichment?.concession_text ?? null,
        ...(concession && ru.rentCents !== null
          ? {
              net_effective_monthly_cents: netEffectiveMonthlyCents({
                advertisedCents: ru.rentCents,
                concession,
              }),
              concession_applies_lease_months: concession.leaseMonths,
              ...(concession.kind === 'free_weeks' ? { concession_free_weeks: concession.weeks } : {}),
              ...(concession.kind === 'free_months' ? { concession_free_months: concession.months } : {}),
              ...(concession.kind === 'flat_discount' ? { concession_value_cents: concession.valueCents } : {}),
            }
          : {}),
        pets_allowed: enrichment?.pets_allowed ?? 'not_mentioned',
        furnished: enrichment?.furnished ?? 'not_mentioned',
        short_term_ok: enrichment?.short_term_ok ?? null,
        generated_summary: enrichment?.summary ?? null,
        available_on: ru.availableOn,
        is_available_now: ru.availableOn !== null && ru.availableOn <= nowIso.slice(0, 10),
        first_seen_at: nowIso, // upsert keeps the earlier first_listed_at on conflict
        last_confirmed_at: nowIso,
        estimated_publish_date: nowIso.slice(0, 10),
        events: [
          { at: nowIso, kind: 'first_listed', from_cents: null, to_cents: ru.rentCents, note: null },
        ],
      })
      units.push(record)
    } catch (e) {
      failures.push({ externalId: ru.externalId, error: (e as Error).message }) // counted, never silent (spec §5)
    }
  }
  return { units, failures }
}

async function cachedEnrichment(
  pool: pg.Pool,
  hash: string,
  llm: LlmEnricher | null,
  texts: string[],
): Promise<LlmEnrichment | null> {
  const { rows } = await pool.query(`SELECT extracted FROM extract_cache WHERE content_hash = $1`, [hash])
  if (rows[0]) return rows[0].extracted as LlmEnrichment
  if (!llm || texts.every((t) => !t.trim())) return null
  try {
    const out = await llm(texts)
    if (out) {
      await pool.query(
        `INSERT INTO extract_cache (content_hash, extracted) VALUES ($1, $2)
         ON CONFLICT (content_hash) DO NOTHING`,
        [hash, JSON.stringify(out)],
      )
    }
    return out
  } catch {
    return null // fail-open by design: enrichment degrades, the listing still lands
  }
}
```

Plus `createHaikuEnricher(): LlmEnricher | null` in the same file: returns `null` if `!process.env.ANTHROPIC_API_KEY`; otherwise a function making ONE `client.messages.parse` call (model `claude-haiku-4-5`, `max_tokens: 1024`, zodOutputFormat over a Zod schema mirroring `LlmEnrichment` with enums pinned to the schema's own enum values — pets from the `pets_allowed` enum, concession kinds `free_weeks|free_months|flat_discount`, plus `null`s) with a system prompt: "Extract ONLY facts stated in these apartment listing texts; null for anything not stated. Never guess." following the structural pattern of `packages/search/src/llm-parse.ts`. On refusal/parse-miss return null. Export `extractSnapshot`, `createHaikuEnricher`, types from `packages/pipeline/src/index.ts`. Add `@anthropic-ai/sdk` + `zod` + `@aptv2/scrapers` to `packages/pipeline` deps as needed.

Run: `pnpm --filter @aptv2/pipeline test` → all green (extract + existing upsert suites). `pnpm -r typecheck` clean.

- [ ] **Step 5: Commit and merge**

```bash
git add packages/scrapers packages/pipeline pnpm-lock.yaml
git commit -m "feat: rentcafe adapter + fail-open extract stage with content-hash cache"
git checkout plan4-integration && git merge --no-ff task/p4-4-adapter-extract
```

---

### Task 5: Worker jobs — scheduled scrape → process, sweeps, scrape_runs

**Files:**
- Create: `apps/worker/src/jobs/scrape.ts`, `apps/worker/test/scrape.test.ts`, `apps/worker/src/smoke.ts`
- Modify: `apps/worker/src/index.ts` (register + schedule), `apps/worker/package.json` (deps `@aptv2/scrapers`, `@aptv2/pipeline`, `@aptv2/schema`; script `"smoke": "tsx src/smoke.ts"`), `apps/worker/vitest.config.ts` (DB-test shape: setupFiles + `fileParallelism: false`, testTimeout 20000), create `apps/worker/test/setup.ts` (root-.env dotenv, same as pipeline's)
- Modify: `packages/pipeline/src/upsert.ts` (THREE sanctioned amendments below), `packages/pipeline/src/index.ts` (export new helpers), `packages/pipeline/test/upsert.test.ts` (cover them)

**Interfaces:**
- Consumes: everything Tasks 1–4 produced; `createBoss` and the job-registration pattern in `apps/worker/src/index.ts`; `upsertProcessedUnits`.
- Produces:
  - Pipeline amendments: `upsertProcessedUnits(pool, units, opts?: { sourceRef?: number })` — when `sourceRef` is given, listings rows get `source_ref = $sourceRef`; **price history must ACCUMULATE on the conflict path** (see below); and neighborhood resolution falls back to spatial lookup: when the by-name lookup misses (scraped rows carry `neighborhood: ""`), resolve `SELECT id, name FROM neighborhoods WHERE ST_Covers(boundary, ST_SetSRID(ST_MakePoint($lng,$lat),4326)::geography) LIMIT 1` and use that row's id (listing's `neighborhood_id`) — display name comes from the join at read time, so no schema change.
  - **Price-history accumulation (the third upsert amendment — review must-fix).** Plan 3's `DO UPDATE SET events = EXCLUDED.events, price_history = EXCLUDED.price_history, price_changes = EXCLUDED.price_changes` overwrites history, and every scrape emits a fresh single `first_listed` event — so a live rent change would ERASE the old price instead of recording it, killing the product's price-history spine. Replace those three clauses with append semantics, all in SQL on the conflict path:
    - `events`: `CASE WHEN listings.price_cents IS NOT NULL AND EXCLUDED.price_cents IS NOT NULL AND listings.price_cents <> EXCLUDED.price_cents THEN listings.events || jsonb_build_array(jsonb_build_object('at', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'kind', CASE WHEN EXCLUDED.price_cents < listings.price_cents THEN 'price_drop' ELSE 'price_increase' END, 'from_cents', listings.price_cents, 'to_cents', EXCLUDED.price_cents, 'note', null)) ELSE listings.events END` — prior events always survive; a price change appends exactly one synthesized event; equal or either-side-null prices append nothing (null transitions are unclassifiable — the price columns still update).
    - `price_history`: same CASE, appending `jsonb_build_object('at', <same timestamp expr>, 'from_cents', listings.price_cents, 'to_cents', EXCLUDED.price_cents)` to `listings.price_history`, else keep `listings.price_history`.
    - `price_changes`: `jsonb_array_length(<the new price_history expression>)` — or simpler, recompute after the fact; implementer's choice, stated in the report.
    - Note the asymmetry is deliberate: the INSERT path still uses the record's own events/history verbatim (seed rows author their full deterministic history), and the seed corpus re-run stays idempotent because seed prices never differ between runs — the existing "loads all 26 ... idempotent" test must stay green untouched.
  - `bumpConfirmed(pool, sourceRef: number, at: Date): Promise<number>` — hash short-circuit (spec §5.2): `UPDATE listings SET last_confirmed_at = $2 WHERE source_ref = $1 AND status <> 'gone'`, returns row count.
  - `sweepVanished(pool, sourceRef: number, seenCollapseKeys: string[]): Promise<{ staled: number; gone: number }>` — listings of this source NOT in `seenCollapseKeys`: `active → stale`; already `stale` → `gone` (one-cycle grace, spec §5.4); rows in the seen list that are `stale` come back to `active` (handled by the upsert's status write).
  - Worker job names: `SCRAPE = 'scrape'` (data `{ sourceId: number }`), `PROCESS = 'process-snapshot'` (data `{ snapshotId: number; sourceId: number }`).
  - `runScrape(pool, deps, sourceId)` and `runProcess(pool, deps, { snapshotId, sourceId })` exported pure-ish (deps-injected: `{ fetcher, adapter, llm }`) so tests run them without pg-boss.

- [ ] **Step 1: Branch; write failing pipeline-amendment tests**

```bash
git checkout plan4-integration && git checkout -b task/p4-5-worker-jobs
```

Append to `packages/pipeline/test/upsert.test.ts` a new describe block (reuse the existing seeded setup):

```ts
describe('ingestion helpers', () => {
  it('spatial neighborhood fallback: empty-name record inside the Lake Eola bbox resolves', async () => {
    const u = {
      ...buildSeedUnits(NOW)[0]!,
      source_id: 'rentcafe___spatial-test-1',
      collapse_key: 'rentcafe:spatial-test-1',
      liberal_dedup_cluster: 'orlando:spatial-test-1',
      neighborhood: '',
      platform: 'rentcafe' as const,
      data_provenance: 'scraped' as const,
    }
    const { rows: src } = await pool.query(
      `INSERT INTO sources (platform, name, website_url) VALUES ('rentcafe','Spatial Test','https://example.com/spatial')
       ON CONFLICT (website_url) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    )
    await upsertProcessedUnits(pool, [u], { sourceRef: src[0].id })
    const { rows } = await pool.query(
      `SELECT l.source_ref, n.name FROM listings l JOIN neighborhoods n ON n.id = l.neighborhood_id
       WHERE l.collapse_key = 'rentcafe:spatial-test-1'`,
    )
    expect(rows[0].source_ref).toBe(src[0].id)
    expect(rows[0].name).toBe('Lake Eola Heights') // seed unit 1's coords sit in the Eola bbox
  })

  it('price history accumulates across upserts instead of being overwritten', async () => {
    const base = {
      ...buildSeedUnits(NOW)[0]!,
      source_id: 'rentcafe___pricehist-1',
      collapse_key: 'rentcafe:pricehist-1',
      liberal_dedup_cluster: 'orlando:pricehist-1',
      platform: 'rentcafe' as const,
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
      `SELECT price_cents, events, price_history, price_changes FROM listings WHERE collapse_key = 'rentcafe:pricehist-1'`,
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
    const again = await pool.query(`SELECT events, price_changes FROM listings WHERE collapse_key = 'rentcafe:pricehist-1'`)
    expect(again.rows[0].events).toHaveLength(r.events.length)
    expect(again.rows[0].price_changes).toBe(1)
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
    const { rows } = await pool.query(`SELECT status FROM listings WHERE collapse_key = 'rentcafe:spatial-test-1'`)
    expect(rows[0].status).toBe('gone')
  })
})
```

(Import `bumpConfirmed`, `sweepVanished` from `../src/index`.) Run → FAIL. Implement the two helpers in a new `packages/pipeline/src/lifecycle.ts` (exported from index) and the two upsert amendments (opts param threading `source_ref` into the INSERT + `DO UPDATE SET source_ref = EXCLUDED.source_ref, status = EXCLUDED.status`; spatial fallback in the neighborhood lookup). Run → GREEN, whole pipeline suite green.

- [ ] **Step 2: Failing worker job tests (no pg-boss, no network — deps injected, real Postgres)**

`apps/worker/test/scrape.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '@aptv2/db/test-helpers'
import { seedNeighborhoods } from '@aptv2/pipeline'
import type { PoliteFetcher } from '@aptv2/scrapers'
import { runProcess, runScrape } from '../src/jobs/scrape'

const payload = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../packages/scrapers/fixtures/rentcafe-availability.json', import.meta.url)),
    'utf8',
  ),
)

let pool: Pool
let sourceId: number
const fetcherFor = (body: unknown): PoliteFetcher => ({ fetchJson: async () => ({ status: 200, body }) })

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await resetTestDb(pool)
  await seedNeighborhoods(pool)
  const { rows } = await pool.query(
    `INSERT INTO sources (platform, name, website_url, endpoint_config)
     VALUES ('rentcafe', 'Fixture Community', 'https://example.com',
             '{"endpoint_url":"https://example.com/feed.json","property":{"name":"Fixture Community","address_line1":"1 Fixture St","city":"Orlando","state":"FL","zip":"32801","latitude":28.54,"longitude":-81.38}}')
     RETURNING id`,
  )
  sourceId = rows[0].id
})
afterAll(async () => {
  await pool.end()
})

describe('runScrape → runProcess', () => {
  it('first run: snapshot stored verbatim, run recorded, processing yields active listings', async () => {
    const scrape = await runScrape(pool, { fetcher: fetcherFor(payload) }, sourceId)
    expect(scrape.unchanged).toBe(false)
    const snap = await pool.query(`SELECT id, processing_status FROM raw_snapshots WHERE source_id = $1`, [sourceId])
    expect(snap.rows).toHaveLength(1)

    const processed = await runProcess(pool, { llm: null }, { snapshotId: snap.rows[0].id, sourceId })
    expect(processed.failures).toBe(0)
    expect(processed.upserted).toBeGreaterThanOrEqual(1)
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
    const scrape = await runScrape(pool, { fetcher: fetcherFor(payload) }, sourceId)
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
    const failing: PoliteFetcher = { fetchJson: async () => { throw new Error('boom 503') } }
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
    await runScrape(pool, { fetcher: fetcherFor(payload) }, sourceId)
    const src = await pool.query(`SELECT failure_streak, last_scraped_at FROM sources WHERE id = $1`, [sourceId])
    expect(src.rows[0].failure_streak).toBe(0)
    expect(src.rows[0].last_scraped_at).not.toBeNull()
  })
})
```

Run → FAIL.

- [ ] **Step 3: Implement `apps/worker/src/jobs/scrape.ts`**

Shape (exported: `SCRAPE`, `PROCESS`, `runScrape`, `runProcess`, `registerIngestionJobs`):

```ts
import type pg from 'pg'
import type PgBoss from 'pg-boss'
import {
  createPoliteFetcher, parseRobots, rentcafeAdapter, sha256Json,
  type PoliteFetcher, type SourceRow,
} from '@aptv2/scrapers'
import {
  bumpConfirmed, createHaikuEnricher, extractSnapshot, sweepVanished,
  upsertProcessedUnits, type LlmEnricher,
} from '@aptv2/pipeline'

export const SCRAPE = 'scrape'
export const PROCESS = 'process-snapshot'

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
    // refresh robots policy once per run (cheap; cached in the sources row)
    let policy = source.robots_policy
    try {
      const origin = new URL(source.website_url).origin
      const res = await deps.fetcher.fetchText(`${origin}/robots.txt`, null)
      if (res.status === 200) policy = parseRobots(res.body, 'aptv2-research-bot')
    } catch { /* robots fetch failure keeps the stored policy — recorded below either way */ }

    const snap = await rentcafeAdapter.fetch(source, deps.fetcher)
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

export async function registerIngestionJobs(boss: PgBoss, pool: pg.Pool): Promise<void> {
  await boss.createQueue(SCRAPE)
  await boss.createQueue(PROCESS)
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
  // 3×/day per source, staggered by source id (spec §5.2).
  const { rows: sources } = await pool.query(`SELECT id FROM sources WHERE enabled ORDER BY id`)
  for (const [i, s] of sources.entries()) {
    const minute = (i * 7) % 60
    await boss.schedule(`${SCRAPE}`, `${minute} 6,14,22 * * *`, { sourceId: s.id }, { singletonKey: `scrape-${s.id}` } as never)
  }
}
```

(pg-boss v10 API notes for the implementer: check `node_modules/pg-boss` typings — `schedule(name, cron, data, options)` schedules per-queue, so per-source schedules on ONE queue need distinct schedule names or a single schedule fanning out; if per-queue scheduling can't carry per-source data cleanly in v10, replace the loop with one `boss.schedule(SCRAPE_ALL, ...)` cron job whose handler `boss.send(SCRAPE, { sourceId })` for each enabled source with a small delay between sends — behavior equivalence is what the plan requires, not this exact call shape. State what the installed version supports in the report.)

Wire in `apps/worker/src/index.ts`: after the existing heartbeat registration, `const pool = getPool()` (from `@aptv2/db`) and `await registerIngestionJobs(boss, pool)`. Keep the heartbeat.

Run: `pnpm --filter @aptv2/worker test` → green; whole repo green.

- [ ] **Step 3b: scrape-all CLI (deployment amendment, 2026-08-27)**

`apps/worker/src/scrape-all.ts` — the entry point a hosted cron (GitHub Actions, Plan 5) invokes instead of the long-lived pg-boss process: dotenv root `.env`; load all enabled sources ordered by id; for each, `runScrape` with the real politeness fetcher then (when a new snapshot was produced) `runProcess` with `createHaikuEnricher()`, sequentially, continuing to the next source when one fails (the failure is already recorded in `scrape_runs`/`failure_streak` — log it and move on); print a per-source summary line and exit nonzero if EVERY source failed, zero otherwise. Add script `"scrape:all": "tsx src/scrape-all.ts"`. No test beyond typecheck — it is composition of already-tested functions; DO NOT run it in this task (network discipline: Task 7's DoD is the only sanctioned live run alongside `smoke`).

- [ ] **Step 4: Smoke command (the ONLY networked path besides the scheduler)**

`apps/worker/src/smoke.ts`: dotenv root `.env`; args: `--source <id>`; loads the source, runs `runScrape` with the real politeness fetcher, then `runProcess` with `createHaikuEnricher()`; prints: robots decision, snapshot id + hash, unchanged?, units upserted, failures, and the top-3 resulting listings (name/beds/price) from a quick query. Exits nonzero on error. Add script `"smoke": "tsx src/smoke.ts"`. DO NOT run it in this task — Task 6's DoD runs it once, deliberately.

- [ ] **Step 5: Commit and merge**

```bash
git add apps/worker packages/pipeline pnpm-lock.yaml
git commit -m "feat: scheduled scrape/process worker jobs with sweeps, runs, failure streaks"
git checkout plan4-integration && git merge --no-ff task/p4-5-worker-jobs
```

---

### Task 6: Web — real admin read model, truthful banner, search hardening

**Files:**
- Create: `apps/web/lib/admin.ts`, `apps/web/lib/admin.test.ts` (node-env DB test)
- Modify: `apps/web/app/admin/page.tsx` (swap fixture for real query), `apps/web/lib/fixtures.ts` (delete `makeSources` + its now-unused time constants), `apps/web/components/SeedBanner.tsx` (provenance-truthful copy), `apps/web/app/page.tsx` (pass both counts), `packages/search/src/postgres-search.ts` (LIMIT + corpus split), `packages/search/test/postgres-search.test.ts` (cover), `apps/web/package.json` (`dotenv` moves devDependencies → dependencies)

**Interfaces:**
- Consumes: `sources`, `scrape_runs`, `listings.source_ref`, `SourceHealth` (web-local type), `SearchResult.timing`.
- Produces:
  - `getSourceHealth(pool): Promise<SourceHealth[]>` — one row per source: name/platform/enabled/lastScrapedAt/failureStreak, `activeListings` = count of active listings with that `source_ref`, `listingDelta24h` = latest `listings_found` minus the `listings_found` of the newest run older than 24h (0 when unknown).
  - `SearchResult.timing` gains `corpusSeed: number; corpusScraped: number` (existing `corpus` stays = total).
  - `SEARCH_SQL` gains `LIMIT 500` (comment: safety valve; pagination is future work; collapse operates on the returned page).
  - `SeedBanner` props become `{ seed: number; scraped: number }` with copy: seed count described exactly as before; scraped count described as "N listings scraped from public property sites" — framing constraints apply.

- [ ] **Step 1: Branch; failing search-timing test**

```bash
git checkout plan4-integration && git checkout -b task/p4-6-web-admin
```

Add to `packages/search/test/postgres-search.test.ts`:

```ts
  it('reports corpus split by provenance and caps the page', async () => {
    const r = await service().search('')
    expect(r.timing.corpusSeed).toBe(26)
    expect(r.timing.corpusScraped).toBe(0) // this suite seeds only demo data
    expect(r.timing.corpus).toBe(r.timing.corpusSeed + r.timing.corpusScraped)
    expect(r.listings.length).toBeLessThanOrEqual(500)
  })
```

Run → FAIL. Implement in `postgres-search.ts`: corpus query becomes `SELECT count(*) FILTER (WHERE provenance = 'seed')::int AS seed, count(*) FILTER (WHERE provenance = 'scraped')::int AS scraped FROM listings WHERE status = 'active'`; `timing` fills all three fields; `LIMIT 500` on the outer SEARCH_SQL query with the comment above. Update the `SearchResult` type in `packages/schema/src/types.ts` (`timing` object gains the two fields). GREEN; fix any timing-shape fallout in web tests.

- [ ] **Step 2: Failing admin test, then implement**

`apps/web/lib/admin.test.ts` (`// @vitest-environment node`, dotenv setup like `test/health.test.ts`; real Postgres via `TEST_DATABASE_URL`): insert one source + two `scrape_runs` (one now with `listings_found: 12`, one 25h old with `listings_found: 10`) + two active listings with `source_ref`, then assert `getSourceHealth` returns `activeListings: 2`, `listingDelta24h: 2`, correct name/platform/streak. Implement `apps/web/lib/admin.ts` (server-only import, one SQL query with lateral joins or two grouped queries — implementer's choice, cite which in the report). Swap `app/admin/page.tsx` to `getSourceHealth(getPool())` (async server component; follow the existing page patterns and Next 16 docs note). Delete `makeSources` from `fixtures.ts`; update `admin/page.tsx` imports; fix/remove any test asserting fixture sources.

- [ ] **Step 3: Truthful banner**

`SeedBanner.tsx` becomes:

```tsx
/** Honest provenance, both kinds: seeded demo rows and scraped rows are labeled. */
export function SeedBanner({ seed, scraped }: { seed: number; scraped: number }) {
  return (
    <p className="rounded-card border border-hairline px-3 py-2 text-[12px] text-muted">
      Corpus: {seed} seeded demo listings (built to the v1_processed_unit_data schema; every
      number is arithmetic, not scraped fact){scraped > 0
        ? ` + ${scraped} listings scraped from public property sites, refreshed on a schedule`
        : ""}. 
    </p>
  );
}
```

`app/page.tsx`: `<SeedBanner seed={result.timing.corpusSeed} scraped={result.timing.corpusScraped} />`. Update `SeedBanner`-related test assertions if any exist.

- [ ] **Step 4: dotenv to prod deps**

In `apps/web/package.json` move `"dotenv"` from devDependencies to dependencies (next.config.ts imports it at runtime — Plan-3 deferred item). `pnpm install`.

- [ ] **Step 5: GREEN everywhere + commit**

`pnpm -r --if-present test`, `pnpm -r typecheck`, `pnpm --filter @aptv2/web build` → all green.

```bash
git add apps/web packages/search packages/schema pnpm-lock.yaml
git commit -m "feat: real admin read model, provenance-truthful banner, search page cap"
git checkout plan4-integration && git merge --no-ff task/p4-6-web-admin
```

---

### Task 7: DoD — live smoke, end-to-end evidence, README, merge readiness

**Files:**
- Modify: `apps/web/README.md` (ingestion section), root nothing else
- Test: whole repo + ONE deliberate live smoke + dev-server verification

**Interfaces:** none new.

- [ ] **Step 1: Branch + README**

```bash
git checkout plan4-integration && git checkout -b task/p4-7-dod
```

Add to `apps/web/README.md` (after the seam section) an "Ingestion" section: the five stages in a sentence each; the politeness posture verbatim (robots.txt honored incl. crawl-delay, ≤1 req/s per domain, identified User-Agent with a contact, public endpoints only, facts stored / photos and marketing copy linked never rehosted); how to run it (`pnpm --filter @aptv2/pipeline seed:sources`, worker via `pnpm --filter @aptv2/worker dev`, manual smoke `pnpm --filter @aptv2/worker smoke --source <id>`); extraction described as deterministic-first with fail-open Haiku enrichment. Framing constraints apply to every added sentence.

- [ ] **Step 2: DoD checklist (record evidence for every item)**

1. `pnpm -r --if-present test` all green; `pnpm -r typecheck` clean; `pnpm --filter @aptv2/web build` succeeds.
2. Fresh DB proof: `docker compose down -v && docker compose up -d` (wait for init) → migrate (0001–0006) → `pnpm --filter @aptv2/pipeline seed` → `seed:sources`; both idempotent (run twice, same counts).
3. **Live smoke, once:** `pnpm --filter @aptv2/worker smoke --source <first source id>` — record: robots decision, snapshot hash, units upserted, failures (must be 0 or explained per-unit), the printed top-3 listings. Run it a second time immediately: must print `unchanged: true` and bump confirmations (hash short-circuit proven live). If the live endpoint shape differs from the fixture and the adapter throws — STOP, report the payload diff; that is a finding for the controller, not something to patch silently.
4. Dev server: `/` search shows the scraped listings mixed into results ranked by the blend, banner reads both counts, a scraped listing's detail page renders with provenance `scraped` and links out to the real source URL; `/admin` shows the real source rows with lastScraped/streak/counts; `/api/health` ok.
5. Worker start (`pnpm --filter @aptv2/worker dev` briefly): heartbeat + ingestion queues register, schedules created (log lines recorded), then stopped.
6. String sweep: `git grep -in "hiring" -- apps packages` → zero hits. UA string appears exactly once in source (`politeness.ts`).
7. All Plan 4 commits carry the trailer (`git log --format="%b" plan4-integration ^master | grep -c "Co-Authored-By"` equals commit count).
8. `scrape_runs` and `raw_snapshots` rows from the smoke visible via psql/docker exec — paste them.

- [ ] **Step 3: Commit, merge, stop**

```bash
git add apps/web/README.md
git commit -m "docs: ingestion runbook and politeness posture"
git checkout plan4-integration && git merge --no-ff task/p4-7-dod
```

**Do not merge into master** — the controller merges `plan4-integration` → master only after DoD evidence is reviewed and green (standing user ruling).
