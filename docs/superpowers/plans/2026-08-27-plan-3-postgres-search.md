# Plan 3: Postgres-Backed Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Plan-2 demo running on the real stack: seed corpus loaded into Postgres through a reusable pipeline upsert seam, `SearchService` reimplemented as one SQL query (hard filters + PostGIS + FTS + the spec §6.3 ranking blend), and the demo UI consolidated into the pnpm monorepo at `apps/web` — same UX, real database underneath.

**Architecture:** Four moves. (1) The standalone `web/` demo app becomes `apps/web`, replacing the Plan-1 skeleton (whose `/api/health` endpoint is ported in). (2) Shared logic is extracted to workspace packages: `@aptv2/schema` (the `v1_processed_unit_data` Zod schema, net-effective math, seed builder, taxonomy, domain types) and `@aptv2/pipeline` (one function — `upsertProcessedUnits` — mapping schema records onto the Plan-1 `properties`/`units`/`listings` tables, plus a seed CLI; Plan 4's extract/normalize stages extend this package). (3) Migration 0005 adds the serving fields the demo proved out (dedup cluster, provenance, events, fees, concession detail, per-listing source identity). (4) `@aptv2/search` implements `SearchService` over SQL — the Haiku parse module moves there; retrieval, ranking, and price-undisclosed-last happen in one query; dedup collapse and row→`Listing` mapping happen in TS on the (small) result set.

**Tech Stack:** Existing monorepo stack — pnpm workspaces, Node ≥22, TypeScript 5 strict (tsconfig.base.json), pg 8, PostGIS (postgis/postgis:17-3.5 via docker-compose), Vitest (v3 in packages, v4 in the web app), Next 16.3.3 / React 19.2.8 / Tailwind 4 in the web app, zod ^4.4.3, @anthropic-ai/sdk ^0.121.0.

**Spec:** `docs/superpowers/specs/2026-08-27-apartment-aggregator-design.md` (§3.1 modules, §4 data model, §6 search/ranking). Plan 2 (`docs/superpowers/plans/2026-08-27-plan-2-schema-search-demo.md`) defined the schema/seed/UI this plan re-platforms.

## Global Constraints

- Work happens in the main checkout `X:\apartmentscomv2` (NOT the old `.claude/worktrees/web-ui-skeleton` worktree — Task 6 removes it). Integration branch `plan3-integration` off `master`; task branches `task/p3-<n>-<slug>` branch off it and merge back after review. Master merge only at the end, if green (controller decision).
- **pnpm only.** The monorepo root owns `pnpm-lock.yaml`; `web/package-lock.json` is deleted in Task 1. Run package scripts as `pnpm --filter @aptv2/<pkg> <script>`, installs as `pnpm install` at the root.
- **Postgres must be running for db/pipeline/search tests:** `docker compose up -d` at the root (image creates both `aptv2` and `aptv2_test` via `docker/initdb`). Tests use `TEST_DATABASE_URL` from the root `.env` and `resetTestDb` from `@aptv2/db/test-helpers`; every vitest config touching the DB sets `fileParallelism: false` (tests share one database).
- **Framing constraints (binding for all user-facing copy, README, comments):** describe competitor findings as "studied public payloads from my own browsing session." Never name or hint at any site's anti-bot measures. Do not claim hiring.cafe's AI search doesn't exist. Phrase their pipeline as inference ("the schema implies LLM extraction"), not fact. No hiring.cafe-derived strings anywhere user-facing except the field-name homages `collapse_key`, `liberal_dedup_cluster`, `original_source_id`.
- Prices are integer **cents** in the database and the schema; the UI's `Listing.price` stays whole dollars — the row mapper converts.
- The Anthropic API key is server-only. The parse module (moving to `@aptv2/search`) is imported only from server code; model stays `claude-haiku-4-5`. The parse cache stays the existing in-process `Map`; persisting parses to the `query_parses` table is deliberately out of scope (later plan), while per-search logging to `search_logs` IS in scope (Task 5).
- Ranking weights change deliberately: the demo's interim in-memory blend (0.45 freshness / 0.45 trust / 0.1 history) is superseded by the spec §6.3 blend `0.35·text_relevance + 0.30·freshness + 0.25·trust + 0.10·proximity`. Result-order changes vs the demo are expected and correct.
- Next 16 note: `apps/web/AGENTS.md` warns conventions may differ from training data. Before writing/modifying any `app/` route or page, consult `apps/web/node_modules/next/dist/docs/`; the existing `app/page.tsx` (async server component, awaited `searchParams`) is the reference pattern. If `next dev` re-adds `AGENTS.md` churn, commit it as-is per its own instructions.
- End every commit message with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Consolidate the demo app into the monorepo as `apps/web`

**Files:**
- Delete (git rm): old skeleton `apps/web/app/`, `apps/web/next.config.ts`, `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vitest.config.ts`, `apps/web/test/`, `apps/web/next-env.d.ts`
- Move (git mv): `web/` → `apps/web/`
- Delete: `apps/web/package-lock.json` (post-move; pnpm owns the lockfile)
- Create: `apps/web/app/api/health/route.ts`, `apps/web/test/health.test.ts` (ported from the old skeleton)
- Modify: `apps/web/package.json` (rename to `@aptv2/web`, add workspace dep + dotenv), `apps/web/next.config.ts` (root-.env loading + transpilePackages), `apps/web/vitest.config.ts` (include the new test dir), root `package.json` (add `build` script)

**Interfaces:**
- Consumes: `getPool`, `closePool` from `@aptv2/db` (existing: `getPool(): pg.Pool` reading `process.env.DATABASE_URL`; `closePool(): Promise<void>`).
- Produces: the demo app living at `apps/web` as workspace member `@aptv2/web`, with `GET /api/health` working. All later tasks edit the app at this path.

- [ ] **Step 0: Verify the Plan-2 merge landed on master**

This plan assumes Plan 2's `worktree-web-ui-skeleton` branch was merged into master (done 2026-08-27 as `a63df7b`), which is what put the demo app at `web/` in the main checkout. Verify before anything else:

```bash
cd X:/apartmentscomv2
test -f web/lib/seed.ts && git branch --merged master | grep worktree-web-ui-skeleton
```

Expected: the file exists and the branch prints. If either check fails, **STOP and report to the controller** — do not perform the merge inside this task; nothing else in this plan can run until the controller resolves it.

- [ ] **Step 1: Branches**

```bash
git checkout master
git checkout -b plan3-integration
git checkout -b task/p3-1-consolidate-web
```

- [ ] **Step 2: Remove the old skeleton and move the demo app**

```bash
git rm -r apps/web
# untracked leftovers (node_modules, .next, tsconfig.tsbuildinfo) survive git rm:
rm -rf apps/web
# node_modules/.next move poorly across git mv; pnpm reinstalls them:
rm -rf web/node_modules web/.next
git mv web apps/web
git rm --cached apps/web/package-lock.json
rm -f apps/web/package-lock.json
```

- [ ] **Step 3: Make it a workspace member**

Edit `apps/web/package.json` — change `"name": "web"` to `"name": "@aptv2/web"`, add `"typecheck": "tsc --noEmit"` to scripts, add to `dependencies`: `"@aptv2/db": "workspace:*"`, and to `devDependencies`: `"dotenv": "^16.4.0"`. Leave every existing dep version untouched (Next 16.3.3, React 19.2.8, vitest ^4.1.11, etc.).

Replace `apps/web/next.config.ts` with:

```ts
import type { NextConfig } from "next";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// DATABASE_URL lives in the repo-root .env; Next only auto-loads app-local
// env files, so load the root one for dev/build/start.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const nextConfig: NextConfig = {
  transpilePackages: ["@aptv2/db"],
};

export default nextConfig;
```

Edit root `package.json` scripts — add `"build": "pnpm -r --if-present build"` alongside the existing `test`/`typecheck`.

- [ ] **Step 4: Port the health endpoint and its test**

Create `apps/web/app/api/health/route.ts`:

```ts
import { getPool } from '@aptv2/db'

export async function GET(): Promise<Response> {
  try {
    await getPool().query('SELECT 1')
    return Response.json({ ok: true, db: 'up' })
  } catch {
    return Response.json({ ok: false, db: 'down' }, { status: 503 })
  }
}
```

Create `apps/web/test/health.test.ts` (node environment — this test needs pg, not jsdom):

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

beforeAll(() => {
  config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
})
afterAll(async () => {
  const { closePool } = await import('@aptv2/db')
  await closePool()
})

describe('GET /api/health', () => {
  it('reports db up', async () => {
    const { GET } = await import('../app/api/health/route')
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, db: 'up' })
  })
})
```

The demo's `apps/web/vitest.config.ts` already has `include: ["**/*.test.{ts,tsx}"]`, which picks up `test/health.test.ts` — no config change needed for discovery, but the `@vitest-environment node` pragma is what keeps it off jsdom. Leave the config file untouched.

- [ ] **Step 5: Install and verify green**

```bash
cd X:/apartmentscomv2
docker compose up -d
pnpm install
pnpm -r typecheck
pnpm -r --if-present test
pnpm --filter @aptv2/web build
```

Expected: install links `@aptv2/db` into the web app; typecheck clean everywhere; all suites pass (web 53 + health 1, db, worker); Next build succeeds. If the health test fails on connection, confirm `docker compose up -d` ran and `.env` has `TEST_DATABASE_URL`.

- [ ] **Step 6: Commit and merge**

```bash
git add -A
git commit -m "refactor: consolidate demo app into monorepo as @aptv2/web"
git checkout plan3-integration
git merge --no-ff task/p3-1-consolidate-web
```

---

### Task 2: Migration 0005 — serving fields on listings

**Files:**
- Create: `packages/db/migrations/0005_listing_serving_fields.sql`
- Test: `packages/db/test/schema-serving.test.ts`

**Interfaces:**
- Consumes: existing `listings` table (migration 0003), `resetTestDb(pool)` from `@aptv2/db/test-helpers`.
- Produces: new `listings` columns Task 4's upsert writes and Task 5's search reads: `collapse_key text UNIQUE`, `dedup_cluster text`, `source_platform text NOT NULL DEFAULT 'seed'`, `source_external_id text`, `source_url text`, `provenance text NOT NULL DEFAULT 'seed'`, `estimated_publish_date date`, `description text`, `events jsonb NOT NULL DEFAULT '[]'`, `move_in_fees jsonb NOT NULL DEFAULT '[]'`, `concession jsonb`.

- [ ] **Step 1: Branch**

```bash
git checkout plan3-integration && git checkout -b task/p3-2-migration-0005
```

- [ ] **Step 2: Write the failing test**

`packages/db/test/schema-serving.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '../src/test-helpers.js'

let pool: Pool
let unitId: number
let propertyId: number

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await resetTestDb(pool)
  const { rows: p } = await pool.query(
    `INSERT INTO properties (name, address_line1, city, state, zip, normalized_address, location)
     VALUES ('Ridgewood House', '412 E Ridgewood St', 'Orlando', 'FL', '32801',
             '412 e ridgewood st orlando fl 32801', ST_GeogFromText('POINT(-81.376 28.545)'))
     RETURNING id`,
  )
  propertyId = p[0].id
  const { rows: u } = await pool.query(
    `INSERT INTO units (property_id, kind, external_id, beds, baths, sqft)
     VALUES ($1, 'unit', '402', 1, 1, 705) RETURNING id`,
    [propertyId],
  )
  unitId = u[0].id
})
afterAll(async () => {
  await pool.end()
})

describe('migration 0005 serving fields', () => {
  it('accepts the new columns with sensible defaults', async () => {
    const { rows } = await pool.query(
      `INSERT INTO listings (unit_id, property_id, price_cents, collapse_key, dedup_cluster,
                             source_platform, source_external_id, source_url)
       VALUES ($1, $2, 177500, 'appfolio:ridgewood-402', 'orlando:412-e-ridgewood-st-402',
               'appfolio', 'ridgewood-402', 'https://example.com/appfolio/ridgewood-402')
       RETURNING *`,
      [unitId, propertyId],
    )
    expect(rows[0].provenance).toBe('seed')
    expect(rows[0].events).toEqual([])
    expect(rows[0].move_in_fees).toEqual([])
    expect(rows[0].concession).toBeNull()
  })

  it('enforces collapse_key uniqueness (the upsert identity)', async () => {
    await expect(
      pool.query(
        `INSERT INTO listings (unit_id, property_id, collapse_key)
         VALUES ($1, $2, 'appfolio:ridgewood-402')`,
        [unitId, propertyId],
      ),
    ).rejects.toThrow(/duplicate key/)
  })

  it('rejects out-of-enum provenance', async () => {
    await expect(
      pool.query(
        `INSERT INTO listings (unit_id, property_id, collapse_key, provenance)
         VALUES ($1, $2, 'x:y', 'guessed')`,
        [unitId, propertyId],
      ),
    ).rejects.toThrow(/provenance/)
  })
})
```

Run in `packages/db/`: `pnpm test -- test/schema-serving.test.ts`
Expected: FAIL — `column "collapse_key" of relation "listings" does not exist`.

- [ ] **Step 3: Write the migration**

`packages/db/migrations/0005_listing_serving_fields.sql`:

```sql
-- Serving fields proven out by the Plan-2 demo UI. collapse_key /
-- dedup_cluster are the two-tier dedup homage fields (see web README
-- framing); collapse_key is the idempotent-upsert identity.
ALTER TABLE listings
  ADD COLUMN collapse_key           text UNIQUE,
  ADD COLUMN dedup_cluster          text,
  ADD COLUMN source_platform        text NOT NULL DEFAULT 'seed',
  ADD COLUMN source_external_id     text,
  ADD COLUMN source_url             text,
  ADD COLUMN provenance             text NOT NULL DEFAULT 'seed'
    CHECK (provenance IN ('seed', 'scraped')),
  ADD COLUMN estimated_publish_date date,
  ADD COLUMN description            text,
  ADD COLUMN events                 jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN move_in_fees           jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN concession             jsonb;

CREATE INDEX listings_dedup_cluster ON listings (dedup_cluster);
CREATE INDEX listings_source_identity ON listings (source_platform, source_external_id);
```

- [ ] **Step 4: GREEN**

Run in `packages/db/`: `pnpm test`
Expected: all db suites pass (resetTestDb applies 0005 automatically; existing schema tests stay green because every new column has a default or is nullable).

- [ ] **Step 5: Commit and merge**

```bash
git add packages/db
git commit -m "feat: migration 0005 - listing serving fields (dedup, provenance, events, fees)"
git checkout plan3-integration && git merge --no-ff task/p3-2-migration-0005
```

---

### Task 3: Extract `@aptv2/schema` (Zod schema, seed, taxonomy, domain types)

**Files:**
- Create: `packages/schema/package.json`, `packages/schema/tsconfig.json`, `packages/schema/vitest.config.ts`, `packages/schema/src/index.ts`, `packages/schema/src/types.ts`, `packages/schema/src/taxonomy.ts`
- Move (git mv): `apps/web/lib/schema/processed-unit-data.ts` → `packages/schema/src/processed-unit-data.ts`; `apps/web/lib/schema/processed-unit-data.test.ts` → `packages/schema/src/processed-unit-data.test.ts`; `apps/web/lib/schema/net-effective.ts` → `packages/schema/src/net-effective.ts`; `apps/web/lib/schema/net-effective.test.ts` → `packages/schema/src/net-effective.test.ts`; `apps/web/lib/seed.ts` → `packages/schema/src/seed.ts`; `apps/web/lib/seed.test.ts` → `packages/schema/src/seed.test.ts`; `apps/web/scripts/gen-schema-docs.ts` → `packages/schema/scripts/gen-schema-docs.ts`; `apps/web/docs/schema.md` → `packages/schema/docs/schema.md`
- Modify: `apps/web/lib/types.ts` (becomes a re-export shim + `SourceHealth`), `apps/web/lib/fixtures.ts` (imports from `@aptv2/schema`, re-exports taxonomy), `apps/web/package.json` (add `@aptv2/schema`, drop `zod` and the `gen:schema-docs` script), `apps/web/next.config.ts` (transpilePackages)

**Interfaces:**
- Consumes: nothing outside the moved files.
- Produces: package `@aptv2/schema` exporting (all names unchanged from Plan 2): `ProcessedUnitDataSchema`, `ProcessedUnitData`, `ListingEventSchema`, `ListingEvent` (the snake_case schema one), `SOURCE_ID_SEPARATOR`, `UNIT_AMENITIES`, `COMMUNITY_AMENITIES`, `LISTING_EVENT_KINDS`, `minimalUnit()`, `netEffectiveMonthlyCents(input)`, `Concession`, `buildSeedUnits(now: Date)`, `toListing(u, now)`, `GEO` (neighborhood centroids record), `NEIGHBORHOOD_ALIASES`, `AMENITY_KEYWORDS`, and the domain types `Listing`, `TrueCost`, `PriceChange`, `ScoreComponents`, `ListingStatus`, `UiListingEvent`, `ParsedQuery`, `SearchResult`, `SearchService`. Tasks 4–5 import exactly these.

- [ ] **Step 1: Branch**

```bash
git checkout plan3-integration && git checkout -b task/p3-3-schema-package
```

- [ ] **Step 2: Scaffold the package**

`packages/schema/package.json`:

```json
{
  "name": "@aptv2/schema",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "gen:schema-docs": "tsx scripts/gen-schema-docs.ts"
  },
  "dependencies": { "zod": "^4.4.3" },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0",
    "tsx": "^4.19.0"
  }
}
```

`packages/schema/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src", "scripts"]
}
```

`packages/schema/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {},
})
```

- [ ] **Step 3: Move the files**

```bash
mkdir -p packages/schema/src packages/schema/scripts packages/schema/docs
git mv apps/web/lib/schema/processed-unit-data.ts packages/schema/src/processed-unit-data.ts
git mv apps/web/lib/schema/processed-unit-data.test.ts packages/schema/src/processed-unit-data.test.ts
git mv apps/web/lib/schema/net-effective.ts packages/schema/src/net-effective.ts
git mv apps/web/lib/schema/net-effective.test.ts packages/schema/src/net-effective.test.ts
git mv apps/web/lib/seed.ts packages/schema/src/seed.ts
git mv apps/web/lib/seed.test.ts packages/schema/src/seed.test.ts
git mv apps/web/scripts/gen-schema-docs.ts packages/schema/scripts/gen-schema-docs.ts
git mv apps/web/docs/schema.md packages/schema/docs/schema.md
```

- [ ] **Step 4: Create the shared types and taxonomy modules**

`packages/schema/src/types.ts` — move the domain types out of `apps/web/lib/types.ts` verbatim, with ONE rename to avoid clashing with the schema's snake_case `ListingEvent`: the UI event type is exported as `UiListingEvent`. (Confirmed: `Listing` already carries `alsoListedOn` and `dedupCluster: string` — `apps/web/lib/types.ts:71-74` — so the verbatim copy brings along everything Task 5's `rowToListing` assigns; if the copy somehow surfaces a missing field, add it HERE, not in Task 5.) Copy from `apps/web/lib/types.ts` the interfaces `PriceChange`, `ScoreComponents`, `TrueCost`, `ListingEvent` (rename to `UiListingEvent`), `Listing`, `ParsedQuery`, `SearchResult`, `SearchService` and the type `ListingStatus`, keeping every field and comment identical. In the copied `Listing`, the `events` field becomes `events: UiListingEvent[];`. Do NOT copy `SourceHealth` (it stays web-local).

`packages/schema/src/taxonomy.ts` — move `NEIGHBORHOOD_ALIASES` and `AMENITY_KEYWORDS` verbatim from `apps/web/lib/fixtures.ts`:

```ts
// The neighborhood and amenity taxonomy. Feeds the LLM parser's closed
// enums (spec §6.1) and the keyword-fallback matcher.

export const NEIGHBORHOOD_ALIASES: Record<string, string[]> = {
  "Lake Eola Heights": ["lake eola heights", "lake eola", "eola"],
  "Thornton Park": ["thornton park"],
  "Downtown Orlando": ["downtown orlando", "downtown", "cbd"],
  "Mills 50": ["mills 50", "mills fifty"],
  "College Park": ["college park"],
  "Baldwin Park": ["baldwin park"],
  SoDo: ["sodo", "south downtown"],
  "Audubon Park": ["audubon park"],
  "Lake Nona": ["lake nona"],
};

export const AMENITY_KEYWORDS: Record<string, string[]> = {
  pool: ["pool"],
  gym: ["gym", "fitness"],
  "in-unit laundry": ["in-unit laundry", "washer", "laundry"],
  "pet friendly": ["pet friendly", "pets", "dog", "cat"],
  parking: ["parking", "garage"],
  balcony: ["balcony"],
};
```

`packages/schema/src/index.ts`:

```ts
export * from "./processed-unit-data";
export * from "./net-effective";
export * from "./seed";
export * from "./taxonomy";
export * from "./types";
```

- [ ] **Step 5: Fix imports inside the moved files**

- `packages/schema/src/seed.ts`: change `import type { Listing, ListingEvent as UiEvent, TrueCost } from "./types";` — the path stays `./types` (the new file), but the imported name is now `UiListingEvent`: `import type { Listing, UiListingEvent as UiEvent, TrueCost } from "./types";`. Also add `export` to the `const GEO` declaration (`export const GEO: Record<string, [number, number]> = {...}`) — Task 4's neighborhood seeding uses it. All other relative imports (`./schema/processed-unit-data` → `./processed-unit-data`, `./schema/net-effective` → `./net-effective`) must be updated to the flat `src/` layout.
- `packages/schema/src/seed.test.ts`: `./schema/processed-unit-data` → `./processed-unit-data`, `./seed` stays.
- `packages/schema/scripts/gen-schema-docs.ts`: import path `../lib/schema/processed-unit-data` → `../src/processed-unit-data`; the `writeFileSync` target stays `"docs/schema.md"` (now resolves to `packages/schema/docs/schema.md` when run via the package script).

- [ ] **Step 6: Re-point the web app**

- `apps/web/lib/types.ts` — replace the whole file with:

```ts
// Domain types now live in @aptv2/schema (shared with pipeline + search).
// This shim keeps the app's "@/lib/types" import path stable.
export type {
  Listing,
  ListingStatus,
  PriceChange,
  ScoreComponents,
  TrueCost,
  UiListingEvent as ListingEvent,
  ParsedQuery,
  SearchResult,
  SearchService,
} from "@aptv2/schema";

// Admin / ops (§8) — read model over sources + scrape_runs. Web-local.
export interface SourceHealth {
  id: string;
  name: string;
  platform: string;
  enabled: boolean;
  lastScrapedAt: string | null;
  failureStreak: number;
  activeListings: number;
  listingDelta24h: number;
}
```

- `apps/web/lib/fixtures.ts` — delete the local `NEIGHBORHOOD_ALIASES`/`AMENITY_KEYWORDS` definitions and the `./seed` import; the top becomes:

```ts
import type { Listing, SourceHealth } from "./types";
import { buildSeedUnits, toListing } from "@aptv2/schema";

export { NEIGHBORHOOD_ALIASES, AMENITY_KEYWORDS } from "@aptv2/schema";
```

(`makeListings` and `makeSources` bodies stay unchanged; keep the `MIN`/`HOUR`/`DAY` constants `makeSources` uses.)

- `apps/web/lib/parse/llm-parse.ts` — no edit needed: it imports `AMENITY_KEYWORDS, NEIGHBORHOOD_ALIASES` from `../fixtures`, which now re-exports them.
- `apps/web/package.json` — add `"@aptv2/schema": "workspace:*"` to dependencies; remove `"zod"` from dependencies (only the moved files used it directly — verify with `grep -r "from \"zod\"" apps/web/lib apps/web/app apps/web/components`; `llm-parse.ts` DOES use zod, so if it still matches, keep the dep until Task 5 moves that file — in that case leave `zod` in place and remove it in Task 5). Remove the `"gen:schema-docs"` script.
- `apps/web/next.config.ts` — `transpilePackages: ["@aptv2/db", "@aptv2/schema"]`.

- [ ] **Step 7: GREEN**

```bash
pnpm install
pnpm --filter @aptv2/schema test        # schema + seed + math suites, moved intact
pnpm --filter @aptv2/schema gen:schema-docs   # rewrites packages/schema/docs/schema.md (93 fields)
pnpm -r typecheck
pnpm --filter @aptv2/web test           # web suites still green via the shim
pnpm --filter @aptv2/web build
```

- [ ] **Step 8: Commit and merge**

```bash
git add -A
git commit -m "refactor: extract @aptv2/schema package (schema, seed, taxonomy, domain types)"
git checkout plan3-integration && git merge --no-ff task/p3-3-schema-package
```

---

### Task 4: `@aptv2/pipeline` — upsert seam + seed CLI

**Files:**
- Create: `packages/pipeline/package.json`, `packages/pipeline/tsconfig.json`, `packages/pipeline/vitest.config.ts`, `packages/pipeline/src/index.ts`, `packages/pipeline/src/neighborhoods.ts`, `packages/pipeline/src/upsert.ts`, `packages/pipeline/src/seed-cli.ts`
- Test: `packages/pipeline/test/setup.ts`, `packages/pipeline/test/upsert.test.ts`

**Interfaces:**
- Consumes: `ProcessedUnitData`, `buildSeedUnits`, `GEO`, `NEIGHBORHOOD_ALIASES`, `SOURCE_ID_SEPARATOR` from `@aptv2/schema`; `pg.Pool`; tables from migrations 0001–0005.
- Produces: `seedNeighborhoods(pool): Promise<number>` (rows upserted) and `upsertProcessedUnits(pool, units: ProcessedUnitData[]): Promise<{ properties: number; units: number; listings: number }>` (distinct rows written). Task 5's tests seed the DB through exactly these. This package is the spec §3.1 `pipeline` module seam — Plan 4's extract/normalize stages land here.

- [ ] **Step 1: Branch and scaffold**

```bash
git checkout plan3-integration && git checkout -b task/p3-4-pipeline
```

`packages/pipeline/package.json`:

```json
{
  "name": "@aptv2/pipeline",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "seed": "tsx src/seed-cli.ts"
  },
  "dependencies": {
    "@aptv2/db": "workspace:*",
    "@aptv2/schema": "workspace:*",
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0",
    "dotenv": "^16.4.0",
    "tsx": "^4.19.0"
  }
}
```

`packages/pipeline/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src", "test"]
}
```

`packages/pipeline/vitest.config.ts` (same DB-test shape as `packages/db`):

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
    testTimeout: 20000,
    fileParallelism: false,
  },
})
```

`packages/pipeline/test/setup.ts`:

```ts
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })
```

Run `pnpm install` at the root so the workspace links resolve.

- [ ] **Step 2: Write the failing test**

`packages/pipeline/test/upsert.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '@aptv2/db/test-helpers'
import { buildSeedUnits } from '@aptv2/schema'
import { seedNeighborhoods, upsertProcessedUnits } from '../src/index'

const NOW = new Date('2026-08-27T12:00:00.000Z')

let pool: Pool
const units = buildSeedUnits(NOW)

const normalizedAddress = (u: (typeof units)[number]) =>
  `${u.address_line1} ${u.city} ${u.state} ${u.zip}`.toLowerCase().replace(/\s+/g, ' ')

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await resetTestDb(pool)
  await seedNeighborhoods(pool)
})
afterAll(async () => {
  await pool.end()
})

describe('seedNeighborhoods', () => {
  it('writes one row per centroid-known neighborhood with aliases', async () => {
    const { rows } = await pool.query(
      `SELECT name, aliases FROM neighborhoods WHERE metro = 'orlando' ORDER BY name`,
    )
    expect(rows.length).toBe(8) // the 8 GEO centroids; Lake Nona has no centroid yet
    const eola = rows.find((r) => r.name === 'Lake Eola Heights')!
    expect(eola.aliases).toContain('lake eola')
  })
})

describe('upsertProcessedUnits', () => {
  it('loads all 26 seed listings and is idempotent', async () => {
    const first = await upsertProcessedUnits(pool, units)
    expect(first.listings).toBe(26)
    expect(first.properties).toBe(new Set(units.map(normalizedAddress)).size)

    await upsertProcessedUnits(pool, units) // second run: same state, no dupes
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM listings')
    expect(rows[0].n).toBe(26)
  })

  it('maps the Camellia exemplar faithfully', async () => {
    const { rows } = await pool.query(
      `SELECT l.*, u.beds::float8 AS beds, n.name AS hood
       FROM listings l JOIN units u ON u.id = l.unit_id
       LEFT JOIN neighborhoods n ON n.id = l.neighborhood_id
       WHERE l.collapse_key = 'seed:u0001'`,
    )
    const r = rows[0]
    expect(r.price_cents).toBe(189500)
    expect(r.net_effective_rent_cents).toBe(169317)
    expect(r.beds).toBe(1)
    expect(r.hood).toBe('Lake Eola Heights')
    expect(r.events).toHaveLength(4)
    expect(r.concession.type).toBe('free_weeks')
    expect(r.concession.lease_months).toBe(13)
    expect(r.move_in_fees.map((f: { label: string }) => f.label)).toContain('Application fee')
    expect(r.trust_score).toBeCloseTo(1.0, 5)
    expect(r.search_tsv).toContain('laundri')
  })

  it('models the cross-platform pair as one unit, two listings, one cluster', async () => {
    const { rows } = await pool.query(
      `SELECT l.unit_id, l.dedup_cluster, l.source_platform, l.price_cents
       FROM listings l WHERE l.dedup_cluster = 'orlando:412-e-ridgewood-st-402'
       ORDER BY l.price_cents`,
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].unit_id).toBe(rows[1].unit_id)
    expect(rows.map((r) => r.source_platform).sort()).toEqual(['appfolio', 'rentcafe'])
  })

  it('maps lease terms and price history', async () => {
    const { rows } = await pool.query(
      `SELECT lease_term, price_history, price_changes FROM listings WHERE collapse_key = 'seed:u0003'`,
    )
    // Foundry SoDo: short_term_ok null → 'unknown'; two price drops recorded
    expect(rows[0].lease_term).toBe('unknown')
    expect(rows[0].price_changes).toBe(2)
    expect(rows[0].price_history[0]).toHaveProperty('from_cents')
  })
})
```

Run in `packages/pipeline/`: `pnpm test`
Expected: FAIL — `../src/index` has no exports.

- [ ] **Step 3: Implement neighborhoods seeding**

`packages/pipeline/src/neighborhoods.ts`:

```ts
import type pg from 'pg'
import { GEO, NEIGHBORHOOD_ALIASES } from '@aptv2/schema'

// Seed-approximate neighborhood boundaries: a bbox around each demo
// centroid, half-width 0.005° (~550m). Adjacent boxes DO overlap
// (Lake Eola / Downtown / Thornton centroids are ~0.006–0.007° apart,
// less than the 0.010° two boxes need to stay disjoint) — that is fine:
// the search filters are EXISTS-any and MIN-distance, and what the seed
// corpus relies on is only that each box contains no OTHER hood's
// listings, which holds because every foreign centroid is >0.005° away
// on at least one axis. Replaced by real polygons (Orlando open data /
// OSM) post-demo.
const HALF = 0.005

export async function seedNeighborhoods(pool: pg.Pool): Promise<number> {
  let n = 0
  for (const [name, [lat, lng]] of Object.entries(GEO)) {
    const aliases = NEIGHBORHOOD_ALIASES[name] ?? [name.toLowerCase()]
    await pool.query(
      `INSERT INTO neighborhoods (metro, name, aliases, boundary)
       VALUES ('orlando', $1, $2,
               ST_Multi(ST_MakeEnvelope($3, $4, $5, $6, 4326))::geography)
       ON CONFLICT (metro, name) DO UPDATE
         SET aliases = EXCLUDED.aliases, boundary = EXCLUDED.boundary`,
      [name, aliases, lng - HALF, lat - HALF, lng + HALF, lat + HALF],
    )
    n++
  }
  return n
}
```

- [ ] **Step 4: Implement the upsert**

`packages/pipeline/src/upsert.ts`:

```ts
import type pg from 'pg'
import { SOURCE_ID_SEPARATOR, type ProcessedUnitData } from '@aptv2/schema'

// The proto-normalize stage (spec §5.4): schema-validated records →
// properties/units/listings rows, idempotent on natural keys. Plan 4's
// pipeline calls this exact function with extracted (non-seed) records.

const normalizedAddress = (u: ProcessedUnitData) =>
  `${u.address_line1} ${u.city} ${u.state} ${u.zip}`.toLowerCase().replace(/\s+/g, ' ')

// Trust/completeness (spec §5.5), ported from the demo's in-memory scorer.
function trustScore(u: ProcessedUnitData): number {
  return (
    (u.advertised_rent_cents !== null ? 0.35 : 0) +
    (u.price_level === 'unit' ? 0.25 : 0) +
    (u.sqft !== null ? 0.15 : 0) +
    (u.generated_summary ? 0.15 : 0) +
    (u.unit_amenities.length + u.community_amenities.length > 0 ? 0.1 : 0)
  )
}

function leaseTerm(u: ProcessedUnitData): 'short' | 'long' | 'both' | 'unknown' {
  if (u.short_term_ok === true) return 'both'
  if (u.short_term_ok === false) return 'long'
  return 'unknown'
}

function moveInFees(u: ProcessedUnitData): Array<{ label: string; amount_cents: number }> {
  const fees: Array<{ label: string; amount_cents: number }> = []
  if (u.application_fee_cents) fees.push({ label: 'Application fee', amount_cents: u.application_fee_cents })
  if (u.admin_fee_cents) fees.push({ label: 'Admin fee', amount_cents: u.admin_fee_cents })
  if (u.security_deposit_cents)
    fees.push({
      label: `Security deposit${u.security_deposit_refundable ? ' (refundable)' : ''}`,
      amount_cents: u.security_deposit_cents,
    })
  if (u.pet_deposit_cents) fees.push({ label: 'Pet deposit', amount_cents: u.pet_deposit_cents })
  return fees
}

function concessionJson(u: ProcessedUnitData) {
  if (!['free_weeks', 'free_months', 'flat_discount'].includes(u.concession_type)) return null
  return {
    type: u.concession_type,
    free_weeks: u.concession_free_weeks,
    free_months: u.concession_free_months,
    value_cents: u.concession_value_cents,
    lease_months: u.concession_applies_lease_months,
  }
}

export async function upsertProcessedUnits(
  pool: pg.Pool,
  units: ProcessedUnitData[],
): Promise<{ properties: number; units: number; listings: number }> {
  const propertyIds = new Set<number>()
  const unitIds = new Set<number>()
  let listings = 0

  for (const u of units) {
    const { rows: hood } = await pool.query(
      `SELECT id FROM neighborhoods WHERE metro = 'orlando' AND name = $1`,
      [u.neighborhood],
    )
    const neighborhoodId: number | null = hood[0]?.id ?? null

    const { rows: prop } = await pool.query(
      `INSERT INTO properties
         (name, address_line1, city, state, zip, normalized_address, location,
          neighborhood_id, amenities, management_company, website_url, first_seen_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography,
               $9, $10, $11, $12, $13, $14)
       ON CONFLICT (normalized_address) DO UPDATE SET
         name = EXCLUDED.name,
         neighborhood_id = EXCLUDED.neighborhood_id,
         amenities = EXCLUDED.amenities,
         management_company = EXCLUDED.management_company,
         last_seen_at = GREATEST(properties.last_seen_at, EXCLUDED.last_seen_at)
       RETURNING id`,
      [
        u.property_name, u.address_line1, u.city, u.state, u.zip, normalizedAddress(u),
        u.longitude, u.latitude, neighborhoodId, u.community_amenities,
        u.management_company, u.source_url, u.first_seen_at, u.last_confirmed_at,
      ],
    )
    const propertyId: number = prop[0].id
    propertyIds.add(propertyId)

    const sourceExternalId = u.source_id.split(SOURCE_ID_SEPARATOR)[1] ?? u.source_id
    const kind = u.unit_number ? 'unit' : 'floorplan'
    const externalId = u.unit_number ?? u.floorplan_name ?? sourceExternalId
    const { rows: unit } = await pool.query(
      `INSERT INTO units (property_id, kind, external_id, name, beds, baths, sqft, amenities)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (property_id, kind, external_id) DO UPDATE SET
         beds = EXCLUDED.beds, baths = EXCLUDED.baths, sqft = EXCLUDED.sqft,
         amenities = EXCLUDED.amenities
       RETURNING id`,
      [propertyId, kind, externalId, u.floorplan_name, u.beds, u.baths, u.sqft, u.unit_amenities],
    )
    const unitId: number = unit[0].id
    unitIds.add(unitId)

    const priceHistory = u.events
      .filter((e) => (e.kind === 'price_drop' || e.kind === 'price_increase') && e.from_cents !== null && e.to_cents !== null)
      .map((e) => ({ at: e.at, from_cents: e.from_cents, to_cents: e.to_cents }))
    const searchText = [
      u.property_name, u.neighborhood, u.generated_summary ?? '',
      ...u.unit_amenities, ...u.community_amenities,
    ].join(' ')

    await pool.query(
      `INSERT INTO listings
         (unit_id, property_id, neighborhood_id, location, price_cents, price_is_starting_at,
          net_effective_rent_cents, concessions_text, available_on, lease_term, furnished,
          status, first_listed_at, last_confirmed_at, price_history, price_changes,
          trust_score, search_text, collapse_key, dedup_cluster, source_platform,
          source_external_id, source_url, provenance, estimated_publish_date, description,
          events, move_in_fees, concession)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7,
               $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
               $23, $24, $25, $26, $27, $28, $29, $30)
       ON CONFLICT (collapse_key) DO UPDATE SET
         price_cents = EXCLUDED.price_cents,
         price_is_starting_at = EXCLUDED.price_is_starting_at,
         net_effective_rent_cents = EXCLUDED.net_effective_rent_cents,
         concessions_text = EXCLUDED.concessions_text,
         available_on = EXCLUDED.available_on,
         lease_term = EXCLUDED.lease_term,
         furnished = EXCLUDED.furnished,
         status = EXCLUDED.status,
         last_confirmed_at = EXCLUDED.last_confirmed_at,
         price_history = EXCLUDED.price_history,
         price_changes = EXCLUDED.price_changes,
         trust_score = EXCLUDED.trust_score,
         search_text = EXCLUDED.search_text,
         dedup_cluster = EXCLUDED.dedup_cluster,
         events = EXCLUDED.events,
         move_in_fees = EXCLUDED.move_in_fees,
         concession = EXCLUDED.concession,
         description = EXCLUDED.description`,
      [
        unitId, propertyId, neighborhoodId, u.longitude, u.latitude,
        u.advertised_rent_cents, u.price_level === 'floorplan_starting_at',
        u.net_effective_monthly_cents, u.concession_text_raw, u.available_on,
        leaseTerm(u), u.furnished === 'furnished', u.listing_status,
        u.first_seen_at, u.last_confirmed_at, JSON.stringify(priceHistory),
        priceHistory.length, trustScore(u), searchText, u.collapse_key,
        u.liberal_dedup_cluster, u.platform, sourceExternalId, u.source_url,
        u.data_provenance, u.estimated_publish_date, u.generated_summary,
        JSON.stringify(u.events), JSON.stringify(moveInFees(u)),
        JSON.stringify(concessionJson(u)),
      ],
    )
    listings++
  }
  return { properties: propertyIds.size, units: unitIds.size, listings }
}
```

`packages/pipeline/src/index.ts`:

```ts
export { seedNeighborhoods } from './neighborhoods'
export { upsertProcessedUnits } from './upsert'
```

Note: `JSON.stringify(concessionJson(u))` turns `null` into the string `"null"` for a jsonb column, which stores JSON null — the test asserts `toBeNull()`, and pg maps jsonb null to JS null on read. If the test instead sees the string `'null'`, pass `concessionJson(u)` directly (pg serializes objects) and only stringify the array parameters.

- [ ] **Step 5: GREEN**

Run in `packages/pipeline/`: `pnpm test`
Expected: all 5 tests pass. `pnpm -r typecheck` clean.

- [ ] **Step 6: Seed CLI**

`packages/pipeline/src/seed-cli.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { getPool, closePool } from '@aptv2/db'
import { buildSeedUnits } from '@aptv2/schema'
import { seedNeighborhoods, upsertProcessedUnits } from './index'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

const pool = getPool()
const hoods = await seedNeighborhoods(pool)
const counts = await upsertProcessedUnits(pool, buildSeedUnits(new Date()))
console.log(
  `Seeded ${hoods} neighborhoods, ${counts.properties} properties, ` +
  `${counts.units} units, ${counts.listings} listings`,
)
await closePool()
```

Verify against the dev database:

```bash
pnpm --filter @aptv2/db migrate
pnpm --filter @aptv2/pipeline seed
```

Expected output: `Seeded 8 neighborhoods, ... 26 listings`. Run it twice — second run prints the same counts (idempotent).

- [ ] **Step 7: Commit and merge**

```bash
git add packages/pipeline pnpm-lock.yaml
git commit -m "feat: @aptv2/pipeline upsert seam + neighborhood seeding + seed CLI"
git checkout plan3-integration && git merge --no-ff task/p3-4-pipeline
```

---

### Task 5: `@aptv2/search` — SQL SearchService, parse modules move, web wiring

> **Execution amendments (2026-08-27, controller rulings on review findings — the shipped code follows these, superseding the verbatim blocks below):**
> 1. SEARCH_SQL's furnished filter is `AND ($3::boolean IS NULL OR (l.furnished IS TRUE) = $3)` — the plan's `l.furnished = $3` silently dropped furnished-NULL rows from `furnished: false` queries (`NULL = false` is NULL) while the mapper presents them as not-furnished. Covering tests added (furnished:false → all 25 collapsed seed listings; furnished:true → 0).
> 2. Both SQL statements select `to_char(l.available_on, 'YYYY-MM-DD') AS available_on` (Row type `string | null`, mapper passes through; `isoDate` helper removed) — node-pg parses `date` at local midnight, so the plan's `toISOString().slice(0,10)` was off by one day on UTC+ machines.
> 3. SEARCH_SQL's outer ORDER BY gains a deterministic tiebreaker: `ORDER BY (q.price_cents IS NULL) ASC, score_total DESC, q.source_platform, q.source_external_id`.

**Files:**
- Create: `packages/search/package.json`, `packages/search/tsconfig.json`, `packages/search/vitest.config.ts`, `packages/search/src/index.ts`, `packages/search/src/keyword-parse.ts`, `packages/search/src/postgres-search.ts`
- Move (git mv): `apps/web/lib/parse/llm-parse.ts` → `packages/search/src/llm-parse.ts`; `apps/web/lib/parse/llm-parse.test.ts` → `packages/search/src/llm-parse.test.ts`
- Test: `packages/search/test/setup.ts`, `packages/search/test/postgres-search.test.ts`
- Modify: `apps/web/lib/search.ts` (thin wiring to the package), `apps/web/package.json` (deps), `apps/web/next.config.ts` (transpilePackages)
- Delete: `apps/web/lib/mock-search.ts`, `apps/web/lib/search.test.ts` (in-memory service + its tests — behavior now covered by the package's SQL tests; the keyword parser survives as `keyword-parse.ts`)

**Interfaces:**
- Consumes: `ParsedQuery`, `Listing`, `SearchResult`, `SearchService`, `TrueCost`, `UiListingEvent`, `NEIGHBORHOOD_ALIASES`, `AMENITY_KEYWORDS`, `SOURCE_ID_SEPARATOR` from `@aptv2/schema`; `upsertProcessedUnits`, `seedNeighborhoods` from `@aptv2/pipeline` (tests only); migration-0005 columns.
- Produces: `createSearchService(getPool: () => pg.Pool, opts?: { parse?: (raw: string) => Promise<ParsedQuery> }): SearchService`; `parseQuery(raw): Promise<ParsedQuery>`; `parseQueryWith(raw, client, opts?)`; `__resetParseCacheForTests()`; `parseQueryKeywords(raw): ParsedQuery`. The web app consumes `createSearchService` + `getPool`.

- [ ] **Step 1: Branch and scaffold**

```bash
git checkout plan3-integration && git checkout -b task/p3-5-search
```

`packages/search/package.json`:

```json
{
  "name": "@aptv2/search",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@aptv2/db": "workspace:*",
    "@aptv2/schema": "workspace:*",
    "@anthropic-ai/sdk": "^0.121.0",
    "pg": "^8.13.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@aptv2/pipeline": "workspace:*",
    "@types/pg": "^8.11.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0",
    "dotenv": "^16.4.0"
  }
}
```

`packages/search/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src", "test"]
}
```

`packages/search/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
    testTimeout: 20000,
    fileParallelism: false,
  },
})
```

`packages/search/test/setup.ts`:

```ts
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })
```

- [ ] **Step 2: Move the keyword parser into the package**

Create `packages/search/src/keyword-parse.ts` by porting `parseQueryMock` from `apps/web/lib/mock-search.ts` verbatim under the name `parseQueryKeywords` — same body, new imports:

```ts
import { AMENITY_KEYWORDS, NEIGHBORHOOD_ALIASES, type ParsedQuery } from "@aptv2/schema";

/** Deterministic keyword rung of the fail-open ladder (spec §6.1). */
export function parseQueryKeywords(raw: string): ParsedQuery {
  const q = raw.toLowerCase();

  const neighborhoods = Object.entries(NEIGHBORHOOD_ALIASES)
    .filter(([, aliases]) => aliases.some((a) => q.includes(a)))
    .map(([name]) => name);

  const priceMatch = q.match(
    /(?:under|below|less than|<=?|max)\s*\$?\s*([\d,]+)\s*(k?)/,
  );
  let priceMax: number | null = null;
  if (priceMatch) {
    const n = Number(priceMatch[1].replace(/,/g, ""));
    priceMax = priceMatch[2] === "k" ? n * 1000 : n;
  }

  let bedsMin: number | null = null;
  if (/\bstudio\b/.test(q)) bedsMin = 0;
  const bedsMatch = q.match(/(\d)\s*(?:br|bed|beds|bedroom|bedrooms)\b/);
  if (bedsMatch) bedsMin = Number(bedsMatch[1]);

  const furnished = /\bunfurnished\b/.test(q)
    ? false
    : /\bfurnished\b/.test(q)
      ? true
      : null;

  const shortTerm = /short[\s-]?term|month[\s-]?to[\s-]?month/.test(q)
    ? true
    : null;

  const amenities = Object.entries(AMENITY_KEYWORDS)
    .filter(([, keywords]) => keywords.some((k) => q.includes(k)))
    .map(([name]) => name);

  const recognizedAnything =
    neighborhoods.length > 0 ||
    priceMax !== null ||
    bedsMin !== null ||
    furnished !== null ||
    shortTerm !== null ||
    amenities.length > 0;

  return {
    neighborhoods,
    priceMax,
    bedsMin,
    furnished,
    shortTerm,
    amenities,
    // Fail-open ladder (§6.1): nothing recognized → raw text runs as FTS.
    residualText: recognizedAnything ? "" : raw.trim(),
    failedOpen: !recognizedAnything && raw.trim().length > 0,
    parseSource: "fallback" as const,
    parseMs: 0,
  };
}
```

(TS pattern-match indices under `noUncheckedIndexedAccess`: `priceMatch[1]`/`bedsMatch[1]` are typed `string | undefined` in the base config — the web app's looser tsconfig allowed them. Where the compiler complains, use the non-null assertion `priceMatch[1]!` — the regex guarantees the group.)

- [ ] **Step 3: Move the LLM parse module**

```bash
mkdir -p packages/search/src
git mv apps/web/lib/parse/llm-parse.ts packages/search/src/llm-parse.ts
git mv apps/web/lib/parse/llm-parse.test.ts packages/search/src/llm-parse.test.ts
rmdir apps/web/lib/parse
```

Edit `packages/search/src/llm-parse.ts`:
- Delete the line `import "server-only";` (the package runs under plain vitest; the web app enforces server-only-ness at its own boundary — `lib/search.ts` keeps the `server-only` import).
- Replace `import { AMENITY_KEYWORDS, NEIGHBORHOOD_ALIASES } from "../fixtures";` with `import { AMENITY_KEYWORDS, NEIGHBORHOOD_ALIASES, type ParsedQuery } from "@aptv2/schema";` and delete the separate `import type { ParsedQuery } from "../types";` line.
- Replace `import { parseQueryMock } from "../mock-search";` with `import { parseQueryKeywords } from "./keyword-parse";` and change the one call site `parseQueryMock(raw)` to `parseQueryKeywords(raw)`.

Edit `packages/search/src/llm-parse.test.ts`: only the import path changes (`./llm-parse` is unchanged; there are no other app-relative imports). Run in `packages/search/`: `pnpm install` (root) then `pnpm test -- src/llm-parse.test.ts` → the moved 5 parse tests pass.

- [ ] **Step 4: Write the failing SQL search tests**

`packages/search/test/postgres-search.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '@aptv2/db/test-helpers'
import { buildSeedUnits, type ParsedQuery } from '@aptv2/schema'
import { seedNeighborhoods, upsertProcessedUnits } from '@aptv2/pipeline'
import { createSearchService } from '../src/index'
import { parseQueryKeywords } from '../src/keyword-parse'

const NOW = new Date('2026-08-27T12:00:00.000Z')

let pool: Pool
// Keyword rung only — tests never hit the Anthropic API.
const service = () =>
  createSearchService(() => pool, { parse: async (raw) => parseQueryKeywords(raw) })

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await resetTestDb(pool)
  await seedNeighborhoods(pool)
  await upsertProcessedUnits(pool, buildSeedUnits(NOW))
})
afterAll(async () => {
  await pool.end()
})

describe('postgres SearchService', () => {
  it('answers the canonical demo query from SQL', async () => {
    const r = await service().search(
      'pet friendly 2br under $2400 near Lake Eola with in-unit laundry',
    )
    expect(r.totalCount).toBe(2) // Eola Commons B1 + Eola North 2/2
    expect(r.listings[0].propertyName).toBe('Eola Commons')
    for (const l of r.listings) {
      expect(l.beds).toBeGreaterThanOrEqual(2)
      expect(l.price === null || l.price <= 2400).toBe(true)
      expect(l.amenities).toContain('pet friendly')
      expect(l.amenities).toContain('in-unit laundry')
    }
    expect(r.timing.corpus).toBe(26)
    expect(r.timing.searchMs).toBeGreaterThanOrEqual(0)
  })

  it('collapses the cross-platform duplicate to one card with alsoListedOn', async () => {
    const r = await service().search('1 bed')
    const ridgewood = r.listings.filter((l) => l.propertyName === 'Ridgewood House')
    expect(ridgewood).toHaveLength(1)
    expect(ridgewood[0].price).toBe(1775)
    expect(ridgewood[0].platform).toBe('appfolio')
    expect(ridgewood[0].alsoListedOn).toEqual([{ platform: 'rentcafe', price: 1845 }])
  })

  it('ranks price-undisclosed listings last, never drops them', async () => {
    const r = await service().search('3 bed')
    expect(r.listings.length).toBeGreaterThanOrEqual(2)
    const last = r.listings[r.listings.length - 1]
    expect(last.propertyName).toBe('Baldwin Harbor Flats')
    expect(last.price).toBeNull()
  })

  it('empty query returns the whole active corpus, collapsed', async () => {
    const r = await service().search('')
    expect(r.timing.corpus).toBe(26)
    expect(r.totalCount).toBe(25) // 26 minus the collapsed duplicate
  })

  it('applies shortTerm=false as a hard filter', async () => {
    const p: ParsedQuery = {
      ...parseQueryKeywords(''),
      shortTerm: false,
    }
    const svc = createSearchService(() => pool, { parse: async () => p })
    const r = await svc.search('anything')
    // Camellia is the only seed with short_term_ok=false → lease_term 'long';
    // everything else is 'unknown', which also satisfies "not short-term-ok".
    expect(r.totalCount).toBeGreaterThan(0)
    for (const l of r.listings) expect(l.shortTermOk).toBe(false)
  })

  it('getListing maps the Camellia detail faithfully', async () => {
    const l = await service().getListing('seed___u0001')
    expect(l).not.toBeNull()
    expect(l!.propertyName).toBe('The Camellia at Lake Eola')
    expect(l!.trueCost).toEqual({
      advertisedMonthly: 1895,
      concessionLabel: '6 wk free ÷ 13 mo',
      concessionMonthly: 202,
      netEffectiveMonthly: 1693,
      moveInFees: [
        { label: 'Application fee', amount: 75 },
        { label: 'Admin fee', amount: 250 },
        { label: 'Security deposit (refundable)', amount: 500 },
        { label: 'Pet deposit', amount: 300 },
      ],
    })
    expect(l!.events).toHaveLength(4)
    expect(l!.provenance).toBe('seed')
    // Seeded 47 days before the frozen NOW, but the service measures from
    // the real clock — assert the floor, not an exact value.
    expect(l!.daysOnMarket).toBeGreaterThanOrEqual(47)
  })

  it('logs every search to search_logs', async () => {
    const before = (await pool.query('SELECT count(*)::int AS n FROM search_logs')).rows[0].n
    await service().search('2br in baldwin park')
    const after = (await pool.query('SELECT count(*)::int AS n FROM search_logs')).rows[0].n
    expect(after).toBe(before + 1)
    const { rows } = await pool.query(
      'SELECT raw_query, parse_source, result_count FROM search_logs ORDER BY id DESC LIMIT 1',
    )
    expect(rows[0].raw_query).toBe('2br in baldwin park')
    expect(rows[0].parse_source).toBe('fallback')
    expect(rows[0].result_count).toBeGreaterThanOrEqual(1)
  })
})
```

Timestamp note: seed timestamps are relative to the frozen `NOW` (2026-08-27) but the service computes freshness/days against the real clock — always assert floors/ranges, never exact decay values.

Run in `packages/search/`: `pnpm test -- test/postgres-search.test.ts`
Expected: FAIL — `createSearchService` not exported.

- [ ] **Step 5: Implement the Postgres SearchService**

`packages/search/src/postgres-search.ts`:

```ts
import type pg from 'pg'
import {
  SOURCE_ID_SEPARATOR,
  type Listing,
  type ParsedQuery,
  type SearchResult,
  type SearchService,
  type TrueCost,
  type UiListingEvent,
} from '@aptv2/schema'
import { parseQuery } from './llm-parse'

// Retrieval + ranking per spec §6.2–6.3: one SQL query, hard WHERE
// filters, ST_Covers on neighborhood boundaries, tsquery on residual
// text, linear blend 0.35·text + 0.30·freshness + 0.25·trust +
// 0.10·proximity computed in SQL. Undisclosed price sorts last.
// Dedup collapse (same physical unit, several sources) happens in TS on
// the returned page — the corpus is metro-scale, not web-scale.

const FRESHNESS_HALF_LIFE_SECONDS = 3 * 86_400 // spec §5.5

const SEARCH_SQL = `
SELECT q.*,
       (0.35 * q.text_rel + 0.30 * q.freshness + 0.25 * q.trust_score + 0.10 * q.proximity) AS score_total
FROM (
  SELECT
    l.collapse_key, l.dedup_cluster, l.source_platform, l.source_external_id,
    l.source_url, l.provenance, l.price_cents, l.price_is_starting_at,
    l.net_effective_rent_cents, l.concessions_text, l.available_on, l.lease_term,
    l.furnished, l.status, l.first_listed_at, l.last_confirmed_at,
    l.price_history, l.events, l.move_in_fees, l.concession, l.description,
    l.trust_score::float8 AS trust_score,
    u.beds::float8 AS beds, u.baths::float8 AS baths, u.sqft,
    u.amenities AS unit_amenities,
    p.name AS property_name, p.address_line1, p.city, p.state, p.zip,
    p.amenities AS community_amenities,
    n.name AS neighborhood_name,
    CASE WHEN $7 <> ''
         THEN LEAST(1.0, ts_rank(l.search_tsv, plainto_tsquery('english', $7))::float8 * 10)
         ELSE 0 END AS text_rel,
    power(0.5, EXTRACT(EPOCH FROM (now() - l.last_confirmed_at))::float8 / ${FRESHNESS_HALF_LIFE_SECONDS}) AS freshness,
    COALESCE((SELECT GREATEST(0.0,
                1.0 - MIN(ST_Distance(l.location, ST_Centroid(nh.boundary::geometry)::geography))::float8 / 3000.0)
              FROM neighborhoods nh WHERE nh.name = ANY($6::text[])), 0) AS proximity
  FROM listings l
  JOIN units u ON u.id = l.unit_id
  JOIN properties p ON p.id = l.property_id
  LEFT JOIN neighborhoods n ON n.id = l.neighborhood_id
  WHERE l.status = 'active'
    AND ($1::int IS NULL OR l.price_cents IS NULL OR l.price_cents <= $1)
    AND ($2::int IS NULL OR u.beds >= $2)
    AND ($3::boolean IS NULL OR l.furnished = $3)
    AND ($4::boolean IS NULL OR
         (CASE WHEN $4 THEN l.lease_term IN ('short','both')
               ELSE l.lease_term IN ('long','unknown') END))
    AND (cardinality($5::text[]) = 0 OR (u.amenities || p.amenities) @> $5::text[])
    AND (cardinality($6::text[]) = 0 OR EXISTS (
          SELECT 1 FROM neighborhoods nh2
          WHERE nh2.name = ANY($6::text[]) AND ST_Covers(nh2.boundary, l.location)))
    AND ($7 = '' OR l.search_tsv @@ plainto_tsquery('english', $7))
) q
ORDER BY (q.price_cents IS NULL) ASC, score_total DESC
`

const GET_LISTING_SQL = `
SELECT
  l.collapse_key, l.dedup_cluster, l.source_platform, l.source_external_id,
  l.source_url, l.provenance, l.price_cents, l.price_is_starting_at,
  l.net_effective_rent_cents, l.concessions_text, l.available_on, l.lease_term,
  l.furnished, l.status, l.first_listed_at, l.last_confirmed_at,
  l.price_history, l.events, l.move_in_fees, l.concession, l.description,
  l.trust_score::float8 AS trust_score,
  u.beds::float8 AS beds, u.baths::float8 AS baths, u.sqft,
  u.amenities AS unit_amenities,
  p.name AS property_name, p.address_line1, p.city, p.state, p.zip,
  p.amenities AS community_amenities,
  n.name AS neighborhood_name,
  0::float8 AS text_rel,
  power(0.5, EXTRACT(EPOCH FROM (now() - l.last_confirmed_at))::float8 / ${FRESHNESS_HALF_LIFE_SECONDS}) AS freshness,
  0::float8 AS proximity,
  (0.30 * power(0.5, EXTRACT(EPOCH FROM (now() - l.last_confirmed_at))::float8 / ${FRESHNESS_HALF_LIFE_SECONDS})
   + 0.25 * l.trust_score::float8) AS score_total
FROM listings l
JOIN units u ON u.id = l.unit_id
JOIN properties p ON p.id = l.property_id
LEFT JOIN neighborhoods n ON n.id = l.neighborhood_id
WHERE l.source_platform = $1 AND l.source_external_id = $2
LIMIT 1
`

type Row = {
  collapse_key: string
  dedup_cluster: string
  source_platform: string
  source_external_id: string
  source_url: string
  provenance: 'seed' | 'scraped'
  price_cents: number | null
  price_is_starting_at: boolean
  net_effective_rent_cents: number | null
  concessions_text: string | null
  available_on: Date | null
  lease_term: 'short' | 'long' | 'both' | 'unknown'
  furnished: boolean | null
  status: 'active' | 'stale' | 'gone'
  first_listed_at: Date
  last_confirmed_at: Date
  price_history: Array<{ at: string; from_cents: number; to_cents: number }>
  events: Array<{ at: string; kind: UiListingEvent['kind']; from_cents: number | null; to_cents: number | null; note: string | null }>
  move_in_fees: Array<{ label: string; amount_cents: number }>
  concession: {
    type: 'free_weeks' | 'free_months' | 'flat_discount'
    free_weeks: number | null
    free_months: number | null
    value_cents: number | null
    lease_months: number | null
  } | null
  description: string | null
  trust_score: number
  beds: number
  baths: number
  sqft: number | null
  unit_amenities: string[]
  property_name: string
  address_line1: string
  city: string
  state: string
  zip: string
  community_amenities: string[]
  neighborhood_name: string | null
  text_rel: number
  freshness: number
  proximity: number
  score_total: number
}

const d = (c: number) => Math.round(c / 100)

function trueCostOf(row: Row): TrueCost | null {
  if (row.price_cents === null) return null
  const fees = row.move_in_fees.map((f) => ({ label: f.label, amount: d(f.amount_cents) }))
  const net = row.net_effective_rent_cents ?? row.price_cents
  const c = row.concession
  const lease = c?.lease_months
  const label =
    c?.type === 'free_weeks' && lease ? `${c.free_weeks} wk free ÷ ${lease} mo`
    : c?.type === 'free_months' && lease ? `${c.free_months} mo free ÷ ${lease} mo`
    : c?.type === 'flat_discount' && lease ? `$${d(c.value_cents ?? 0)} off ÷ ${lease} mo`
    : 'No concessions'
  const advertisedMonthly = d(row.price_cents)
  const concessionMonthly = d(row.price_cents - net)
  return {
    advertisedMonthly,
    concessionLabel: label,
    concessionMonthly,
    // Derived after rounding so displayed arithmetic can never drift $1.
    netEffectiveMonthly: advertisedMonthly - concessionMonthly,
    moveInFees: fees,
  }
}

const isoDate = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : null)

function rowToListing(row: Row, now: Date): Listing {
  return {
    id: `${row.source_platform}${SOURCE_ID_SEPARATOR}${row.source_external_id}`,
    propertyId: row.collapse_key,
    propertyName: row.property_name,
    neighborhood: row.neighborhood_name ?? '',
    address: `${row.address_line1}, ${row.city}, ${row.state} ${row.zip}`,
    beds: row.beds,
    baths: row.baths,
    sqft: row.sqft,
    price: row.price_cents === null ? null : d(row.price_cents),
    priceIsStartingAt: row.price_is_starting_at,
    concessionsText: row.concessions_text,
    netEffectiveRent: row.net_effective_rent_cents === null ? null : d(row.net_effective_rent_cents),
    availableDate: isoDate(row.available_on),
    furnished: row.furnished === true,
    shortTermOk: row.lease_term === 'short' || row.lease_term === 'both',
    status: row.status,
    firstListedAt: row.first_listed_at.toISOString(),
    lastConfirmedAt: row.last_confirmed_at.toISOString(),
    priceHistory: row.price_history.map((e) => ({ at: e.at, from: d(e.from_cents), to: d(e.to_cents) })),
    photoUrl: null,
    sourceUrl: row.source_url,
    platform: row.source_platform,
    amenities: [...row.unit_amenities, ...row.community_amenities],
    description: row.description,
    score: {
      textRelevance: row.text_rel,
      freshness: row.freshness,
      trust: row.trust_score,
      proximity: row.proximity,
      total: row.score_total,
    },
    events: row.events.map((e) => ({ at: e.at, kind: e.kind, fromCents: e.from_cents, toCents: e.to_cents, note: e.note })),
    trueCost: trueCostOf(row),
    provenance: row.provenance,
    daysOnMarket: Math.max(0, Math.round((now.getTime() - row.first_listed_at.getTime()) / 86_400_000)),
    alsoListedOn: [],
    dedupCluster: row.dedup_cluster,
  }
}

/** B1 collapse, ported from the demo: cheapest source is the primary card. */
function collapseDuplicates(listings: Listing[]): Listing[] {
  const byCluster = new Map<string, Listing[]>()
  for (const l of listings) {
    const group = byCluster.get(l.dedupCluster) ?? []
    group.push(l)
    byCluster.set(l.dedupCluster, group)
  }
  const out: Listing[] = []
  for (const group of byCluster.values()) {
    if (group.length === 1) {
      out.push(group[0]!)
      continue
    }
    const sorted = [...group].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
    const [primary, ...rest] = sorted
    out.push({
      ...primary!,
      alsoListedOn: rest.map((r) => ({ platform: r.platform, price: r.price })),
    })
  }
  // Collapse must not reorder the SQL ranking: sort the collapsed set the
  // same way the query did (undisclosed price last, then score).
  out.sort((a, b) => {
    if ((a.price === null) !== (b.price === null)) return a.price === null ? 1 : -1
    return b.score.total - a.score.total
  })
  return out
}

const recentSearchMs: number[] = []
function recordP50(ms: number): number {
  recentSearchMs.push(ms)
  if (recentSearchMs.length > 100) recentSearchMs.shift()
  const sorted = [...recentSearchMs].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

export function createSearchService(
  getPool: () => pg.Pool,
  opts: { parse?: (raw: string) => Promise<ParsedQuery> } = {},
): SearchService {
  const parse = opts.parse ?? parseQuery
  return {
    async search(rawQuery: string): Promise<SearchResult> {
      const now = new Date()
      const pool = getPool()
      const parsed = await parse(rawQuery)
      const t0 = performance.now()
      const [{ rows }, corpusRes] = await Promise.all([
        pool.query<Row>(SEARCH_SQL, [
          parsed.priceMax === null ? null : parsed.priceMax * 100,
          parsed.bedsMin,
          parsed.furnished,
          parsed.shortTerm,
          parsed.amenities,
          parsed.neighborhoods,
          parsed.residualText,
        ]),
        pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM listings WHERE status = 'active'`),
      ])
      const collapsed = collapseDuplicates(rows.map((r) => rowToListing(r, now)))
      const searchMs = Math.round((performance.now() - t0) * 100) / 100
      // Spec §6.1: every parse is logged. Awaited for determinism (the
      // insert is sub-ms at this scale) but a logging failure must never
      // fail a search.
      try {
        await pool.query(
          `INSERT INTO search_logs (raw_query, parsed_filters, parse_source, result_count)
           VALUES ($1, $2, $3, $4)`,
          [rawQuery, JSON.stringify(parsed), parsed.parseSource, collapsed.length],
        )
      } catch {
        // counted-visible logging comes with the ops work in a later plan
      }
      return {
        listings: collapsed,
        parsed,
        totalCount: collapsed.length,
        timing: {
          parseMs: parsed.parseMs,
          searchMs,
          p50SearchMs: recordP50(searchMs),
          corpus: corpusRes.rows[0]!.n,
        },
      }
    },

    async getListing(id: string): Promise<Listing | null> {
      const sep = id.indexOf(SOURCE_ID_SEPARATOR)
      if (sep < 0) return null
      const platform = id.slice(0, sep)
      const external = id.slice(sep + SOURCE_ID_SEPARATOR.length)
      const { rows } = await getPool().query<Row>(GET_LISTING_SQL, [platform, external])
      const row = rows[0]
      return row ? rowToListing(row, new Date()) : null
    },
  }
}
```

`packages/search/src/index.ts`:

```ts
export { createSearchService } from './postgres-search'
export { parseQuery, parseQueryWith, __resetParseCacheForTests } from './llm-parse'
export { parseQueryKeywords } from './keyword-parse'
```

The `search_logs` insert is awaited (wrapped in try/catch) precisely so the `logs every search` test is deterministic — do not convert it to fire-and-forget.

- [ ] **Step 6: GREEN on the package**

Run in `packages/search/`: `pnpm test`
Expected: llm-parse suite (5) + postgres suite (7) pass. `pnpm -r typecheck` clean.

- [ ] **Step 7: Wire the web app**

Replace `apps/web/lib/search.ts` entirely with:

```ts
import "server-only";
import { getPool } from "@aptv2/db";
import { createSearchService } from "@aptv2/search";
import type { SearchService } from "./types";

// The real thing: SearchService over Postgres (spec §3.1 module 4).
// getPool is passed lazily so `next build` can import this module
// without a DATABASE_URL.
export const searchService: SearchService = createSearchService(() => getPool());
```

Delete `apps/web/lib/mock-search.ts` and `apps/web/lib/search.test.ts` (`git rm`). Verify nothing else imports them: `grep -rn "mock-search" apps/web` → no hits (fixtures re-exports taxonomy from `@aptv2/schema` since Task 3; component tests build listings via `makeListings`).

`apps/web/package.json`: add `"@aptv2/search": "workspace:*"`; now remove `"zod"` and `"@anthropic-ai/sdk"` from dependencies if no remaining app file imports them (`grep -rn "from \"zod\"\|@anthropic-ai/sdk" apps/web/app apps/web/components apps/web/lib` → expect no hits after the moves).
`apps/web/next.config.ts`: `transpilePackages: ["@aptv2/db", "@aptv2/schema", "@aptv2/search"]`.

One page copy edit: the results timing line at `apps/web/app/page.tsx:93` says `{timing.corpus} listings (in-memory)` — that label becomes a lie once results come from Postgres. Change `(in-memory)` to `(Postgres)` and run `grep -rn "in-memory" apps/web/app apps/web/components` to confirm no other stale copy remains (code comments in `packages/` describing the collapse strategy are fine). Otherwise pages need no edits: `app/page.tsx` and `app/listing/[id]/page.tsx` already consume `searchService` and `result.timing`, and the listing-id format (`seed___u0001`) is unchanged.

- [ ] **Step 8: GREEN end-to-end**

```bash
pnpm install
pnpm -r typecheck
pnpm -r --if-present test
pnpm --filter @aptv2/web build
pnpm --filter @aptv2/db migrate && pnpm --filter @aptv2/pipeline seed
pnpm --filter @aptv2/web dev   # then load the canonical query URL
```

Load `http://localhost:3000/?q=pet+friendly+2br+under+%242400+near+Lake+Eola+with+in-unit+laundry` — parse chips render, results come from Postgres (2 cards), timing line shows real SQL ms, seed banner shows corpus 26. Load `/listing/seed___u0001` — true-cost card $1,895 − $202 = $1,693. Stop the dev server.

- [ ] **Step 9: Commit and merge**

```bash
git add -A
git commit -m "feat: @aptv2/search - SearchService over Postgres with spec ranking blend"
git checkout plan3-integration && git merge --no-ff task/p3-5-search
```

---

### Task 6: DoD verification + docs + cleanup

**Files:**
- Modify: `apps/web/README.md` (run instructions + seam paragraph reflect the real backend)
- Delete: worktree `.claude/worktrees/web-ui-skeleton` + branch `worktree-web-ui-skeleton` (fully merged)
- Test: whole-repo suites + fresh-database run + scripted DoD checklist in the task report

**Interfaces:** none new — this task verifies and documents.

- [ ] **Step 1: Branch**

```bash
git checkout plan3-integration && git checkout -b task/p3-6-dod
```

- [ ] **Step 2: Update the web README**

Edit `apps/web/README.md`:
- **"How to run it"** becomes the monorepo flow:

```bash
docker compose up -d                      # Postgres + PostGIS (repo root)
pnpm install
pnpm --filter @aptv2/db migrate
pnpm --filter @aptv2/pipeline seed        # 26 seeded Orlando listings → Postgres
pnpm --filter @aptv2/web dev
```

  Keep the `ANTHROPIC_API_KEY` paragraph unchanged.
- **"The seam to the real backend"** section: rewrite to state the seam is now filled — pages still talk only to `SearchService` (`@aptv2/schema` types), but the implementation is `@aptv2/search` running one SQL query over `properties`/`units`/`listings` (filters + PostGIS + FTS + the §6.3 blend), with the corpus loaded by `@aptv2/pipeline`'s upsert seam — the same function Plan 4's scrape pipeline will call. The in-memory implementation is gone.
- **Schema pointers**: `docs/schema.md` → `../../packages/schema/docs/schema.md`; `docs/lineage.md` stays app-local (unchanged path). Keep the framing paragraph and the `management_signals` sentence verbatim — only fix relative links.
- **Commands** section: replace `npm` commands with the pnpm-filter equivalents shown above plus `pnpm --filter @aptv2/schema gen:schema-docs`.

- [ ] **Step 3: Run the DoD checklist and record evidence in the report**

1. `pnpm -r --if-present test` → every package green (db, schema, pipeline, search, web incl. health, worker). `pnpm -r typecheck` clean. `pnpm --filter @aptv2/web build` succeeds.
2. Fresh-database proof: `docker compose down -v && docker compose up -d`, wait for init, then `pnpm --filter @aptv2/db migrate` (applies 0001–0005), `pnpm --filter @aptv2/pipeline seed` (prints `8 neighborhoods … 26 listings`), seed again (same counts — idempotent).
3. Dev server: canonical query `pet friendly 2br under $2400 near Lake Eola with in-unit laundry` renders every chip; results are the 2 Lake-Eola 2-beds; timing line reports real SQL latency; badge reads "keyword fallback" without `ANTHROPIC_API_KEY` (or "parsed by Haiku" with it).
4. `/listing/seed___u0001`: true-cost card $1,895 − $202 = $1,693 with move-in fees; time badges render.
5. "1 bed" search: exactly one Ridgewood House card ($1,775, appfolio) with "Also listed at $1,845/mo on rentcafe".
6. Seed banner visible on results (corpus 26); `?debug=1` shows all four score components (text, freshness, trust, proximity) — spot-check one listing's total equals the blend.
7. `GET /api/health` → `{ ok: true, db: "up" }`.
8. String sweep: `git grep -in "hiring" -- apps/web packages` → zero hits (the lineage/README framing never names the site).
9. All Plan 3 commits carry the `Co-Authored-By` trailer: `git log --format="%b" plan3-integration ^master | grep -c "Co-Authored-By"` matches the commit count.
10. `search_logs` has rows from the manual queries: `SELECT raw_query, parse_source, result_count FROM search_logs ORDER BY id DESC LIMIT 5` against the dev DB.

- [ ] **Step 4: Retire the Plan-2 worktree**

The `worktree-web-ui-skeleton` branch is fully merged into master (Plan 2's final merge) and its content now lives at `apps/web`:

```bash
git worktree unlock .claude/worktrees/web-ui-skeleton
git worktree remove --force .claude/worktrees/web-ui-skeleton
git branch -d worktree-web-ui-skeleton
```

(`-d`, not `-D` — if git refuses because the branch is unmerged, STOP and investigate rather than forcing.)

- [ ] **Step 5: Commit, merge, and stop**

```bash
git add apps/web/README.md
git commit -m "docs: monorepo run instructions; SearchService seam now Postgres-backed"
git checkout plan3-integration && git merge --no-ff task/p3-6-dod
```

**Do not merge into master in this task** — the controller merges `plan3-integration` → master only after the DoD evidence is reviewed and green (standing user ruling: "merge to master at the end if green").
