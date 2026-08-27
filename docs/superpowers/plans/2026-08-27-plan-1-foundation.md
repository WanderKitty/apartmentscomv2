# Plan 1: Foundation — Monorepo, Database Schema, Job Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the TypeScript monorepo with Postgres+PostGIS, the complete v1 database schema, a working pg-boss job queue, and web/worker process skeletons — the substrate every later plan builds on.

**Architecture:** pnpm workspace with two apps (`apps/web` Next.js, `apps/worker` pg-boss runner) and one package (`packages/db` — pool, migration runner, SQL migrations, test helpers). Postgres (postgis image via docker-compose) is the sole datastore; migrations are plain forward-only `.sql` files applied by a small in-repo runner.

**Tech Stack:** Node ≥22, pnpm, TypeScript ^5.6 (strict), Next.js ^15 + React ^19, pg ^8.13, pg-boss ^10, Vitest ^3, tsx ^4, dotenv ^16, Docker Desktop (postgis/postgis:17-3.5).

**Spec:** `docs/superpowers/specs/2026-08-27-apartment-aggregator-design.md`

## Global Constraints

- TypeScript `strict: true` everywhere; ESM (`"type": "module"`) in every package.
- Postgres is the only datastore: no Redis, no external queue, no search engine (spec §3).
- Photo URLs are stored as links only; no image downloading/rehosting anywhere (spec §7).
- Module boundaries: `apps/web` may import from `packages/db` (and later `search`); it never imports ingestion code (spec §3.1).
- Migrations are append-only `.sql` files named `NNNN_name.sql`; never edit an applied migration — add a new one.
- Dev environment is Windows (`X:\apartmentscomv2`); all commands must work in PowerShell; Docker Desktop must be running for integration tests.
- Integration tests use `TEST_DATABASE_URL` (the `aptv2_test` database), never `DATABASE_URL`.
- Internal relative imports are extensionless (e.g. `from './client'`) — `moduleResolution: "bundler"`, tsx, and Vitest all resolve them; do not add `.js` suffixes.
- The spec's reserved pgvector `embedding` column is deliberately deferred: the postgis Docker image lacks the pgvector extension, and migrations are append-only, so the semantic-search plan adds it as its own migration.
- Each task is executed on its own branch (`task/<n>-<slug>`), merged only after review.
- End every commit message with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Workspace scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.env.example`
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/vitest.config.ts`, `packages/db/test/setup.ts`
- Test: `packages/db/test/smoke.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: workspace layout `apps/*` + `packages/*`; `tsconfig.base.json` all packages extend; root scripts `pnpm test` / `pnpm typecheck`; per-package Vitest with a `test/setup.ts` that loads the root `.env`.

- [ ] **Step 1: Write root workspace files**

`package.json`:

```json
{
  "name": "aptv2",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true
  }
}
```

`.gitignore`:

```
node_modules/
.next/
dist/
.env
*.tsbuildinfo
```

`.env.example`:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/aptv2
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/aptv2_test
```

- [ ] **Step 2: Write packages/db scaffold**

`packages/db/package.json`:

```json
{
  "name": "@aptv2/db",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./test-helpers": "./src/test-helpers.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "pg": "^8.13.0" },
  "devDependencies": {
    "@types/pg": "^8.11.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0",
    "dotenv": "^16.4.0"
  }
}
```

`packages/db/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

`packages/db/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
    testTimeout: 20000,
  },
})
```

`packages/db/test/setup.ts`:

```ts
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })
```

- [ ] **Step 3: Write the smoke test**

`packages/db/test/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('workspace smoke', () => {
  it('runs tests with env loading in place', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 4: Install and run**

Run: `pnpm install` then `pnpm test`
Expected: install succeeds; 1 test passes in `@aptv2/db`.

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 5: Create local .env and commit**

Copy `.env.example` to `.env` (gitignored).

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore .env.example pnpm-lock.yaml packages/db
git commit -m "chore: scaffold pnpm workspace and db package"
```

---

### Task 2: Local Postgres, pool, and migration runner

**Files:**
- Create: `docker-compose.yml`, `docker/initdb/01-create-test-db.sql`
- Create: `packages/db/src/index.ts`, `packages/db/src/client.ts`, `packages/db/src/migrate.ts`, `packages/db/src/migrate-cli.ts`, `packages/db/src/test-helpers.ts`
- Test: `packages/db/test/client.test.ts`, `packages/db/test/migrate.test.ts`

**Interfaces:**
- Consumes: workspace from Task 1.
- Produces: `getPool(): Pool` and `closePool(): Promise<void>` (reads `DATABASE_URL`); `runMigrations(pool: Pool, dir: string): Promise<string[]>` (returns newly applied filenames); `resetTestDb(pool: Pool): Promise<void>` (drops+recreates `public` schema, reapplies all migrations); CLI `pnpm --filter @aptv2/db migrate`. All later tasks and plans use these exact names.

- [ ] **Step 1: Write docker-compose and init script**

`docker-compose.yml`:

```yaml
services:
  db:
    image: postgis/postgis:17-3.5
    ports:
      - "5432:5432"
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: aptv2
    volumes:
      - ./docker/initdb:/docker-entrypoint-initdb.d
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

`docker/initdb/01-create-test-db.sql`:

```sql
CREATE DATABASE aptv2_test;
```

Run: `docker compose up -d` and wait until `docker compose ps` shows healthy/running.

- [ ] **Step 2: Write failing tests for pool and migration runner**

`packages/db/test/client.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { Pool } from 'pg'

describe('client', () => {
  it('connects to the test database', async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const { rows } = await pool.query('SELECT 1 AS one')
    expect(rows[0].one).toBe(1)
    await pool.end()
  })

  it('getPool throws without DATABASE_URL', async () => {
    const { getPool, closePool } = await import('../src/client')
    const saved = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    await closePool()
    expect(() => getPool()).toThrow('DATABASE_URL')
    process.env.DATABASE_URL = saved
  })
})
```

`packages/db/test/migrate.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runMigrations } from '../src/migrate'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
})
afterAll(async () => {
  await pool.end()
})

describe('runMigrations', () => {
  it('applies pending .sql files in order, once, transactionally', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mig-'))
    await writeFile(path.join(dir, '0001_a.sql'), 'CREATE TABLE mig_a (id int);')
    await writeFile(path.join(dir, '0002_b.sql'), 'CREATE TABLE mig_b (id int);')

    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    const first = await runMigrations(pool, dir)
    expect(first).toEqual(['0001_a.sql', '0002_b.sql'])

    const second = await runMigrations(pool, dir)
    expect(second).toEqual([])

    const { rows } = await pool.query(
      `SELECT filename FROM schema_migrations ORDER BY filename`,
    )
    expect(rows.map((r) => r.filename)).toEqual(['0001_a.sql', '0002_b.sql'])
  })

  it('rolls back a failing migration atomically', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mig-'))
    await writeFile(
      path.join(dir, '0001_bad.sql'),
      'CREATE TABLE mig_c (id int); SELECT nope_not_a_function();',
    )
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await expect(runMigrations(pool, dir)).rejects.toThrow('0001_bad.sql')
    const { rows } = await pool.query(
      `SELECT to_regclass('public.mig_c') AS t`,
    )
    expect(rows[0].t).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @aptv2/db test`
Expected: FAIL — `Cannot find module '../src/client'` / `'../src/migrate'`.

- [ ] **Step 4: Implement client, migrate, CLI, test-helpers, index**

`packages/db/src/client.ts`:

```ts
import pg from 'pg'

let pool: pg.Pool | undefined

export function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    pool = new pg.Pool({ connectionString: url })
  }
  return pool
}

export async function closePool(): Promise<void> {
  await pool?.end()
  pool = undefined
}
```

`packages/db/src/migrate.ts`:

```ts
import type pg from 'pg'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export async function runMigrations(
  pool: pg.Pool,
  dir: string,
): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  const { rows } = await pool.query('SELECT filename FROM schema_migrations')
  const done = new Set(rows.map((r) => r.filename))
  const applied: string[] = []
  for (const f of files) {
    if (done.has(f)) continue
    const sql = await readFile(path.join(dir, f), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [f],
      )
      await client.query('COMMIT')
      applied.push(f)
    } catch (e) {
      await client.query('ROLLBACK')
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`)
    } finally {
      client.release()
    }
  }
  return applied
}
```

`packages/db/src/migrate-cli.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { getPool, closePool } from './client'
import { runMigrations } from './migrate'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

const dir = fileURLToPath(new URL('../migrations', import.meta.url))
const applied = await runMigrations(getPool(), dir)
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Up to date')
await closePool()
```

`packages/db/src/test-helpers.ts`:

```ts
import type pg from 'pg'
import { fileURLToPath } from 'node:url'
import { runMigrations } from './migrate'

const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url))

export async function resetTestDb(pool: pg.Pool): Promise<void> {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await runMigrations(pool, migrationsDir)
}
```

`packages/db/src/index.ts`:

```ts
export { getPool, closePool } from './client'
export { runMigrations } from './migrate'
```

Create the (empty for now) directory `packages/db/migrations/` with a `.gitkeep` file.

Add to `packages/db/package.json` scripts: `"migrate": "tsx src/migrate-cli.ts"` and add `"tsx": "^4.19.0"` to devDependencies, then `pnpm install`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @aptv2/db test`
Expected: PASS (client + migrate suites; smoke still green).

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml docker packages/db
git commit -m "feat: add postgres compose, pool, and sql migration runner"
```

---

### Task 3: Migration 0001 — extensions, sources, raw_snapshots

**Files:**
- Create: `packages/db/migrations/0001_sources_and_snapshots.sql`
- Test: `packages/db/test/schema-sources.test.ts`

**Interfaces:**
- Consumes: `runMigrations`, `resetTestDb` from Task 2.
- Produces: tables `sources` and `raw_snapshots` exactly as below; platform enum values `'rentcafe' | 'appfolio' | 'entrata' | 'unknown'`; snapshot statuses `'pending' | 'processed' | 'failed' | 'skipped_unchanged'`. Plan 2 (ingestion) writes to both tables.

- [ ] **Step 1: Write the failing test**

`packages/db/test/schema-sources.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '../src/test-helpers.js'

let pool: Pool
beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await resetTestDb(pool)
})
afterAll(async () => {
  await pool.end()
})

describe('sources + raw_snapshots schema', () => {
  it('round-trips a source row with defaults', async () => {
    const { rows } = await pool.query(
      `INSERT INTO sources (platform, name, website_url)
       VALUES ('rentcafe', 'The Vue at Lake Eola', 'https://example.com/vue')
       RETURNING *`,
    )
    const s = rows[0]
    expect(s.enabled).toBe(true)
    expect(s.failure_streak).toBe(0)
    expect(Number(s.rate_limit_rps)).toBe(1)
    expect(s.endpoint_config).toEqual({})
  })

  it('rejects unknown platform values', async () => {
    await expect(
      pool.query(
        `INSERT INTO sources (platform, name, website_url)
         VALUES ('zillow', 'Nope', 'https://example.com/nope')`,
      ),
    ).rejects.toThrow(/violates check constraint/)
  })

  it('stores a raw snapshot linked to a source', async () => {
    const { rows: srcRows } = await pool.query(
      `SELECT id FROM sources LIMIT 1`,
    )
    const { rows } = await pool.query(
      `INSERT INTO raw_snapshots (source_id, content_hash, payload)
       VALUES ($1, 'abc123', '{"units": []}'::jsonb)
       RETURNING *`,
      [srcRows[0].id],
    )
    expect(rows[0].processing_status).toBe('pending')
    expect(rows[0].payload).toEqual({ units: [] })
  })

  it('has postgis available', async () => {
    const { rows } = await pool.query(`SELECT PostGIS_Version() AS v`)
    expect(rows[0].v).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aptv2/db test -- schema-sources`
Expected: FAIL — relation "sources" does not exist.

- [ ] **Step 3: Write the migration**

`packages/db/migrations/0001_sources_and_snapshots.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE sources (
  id             serial PRIMARY KEY,
  platform       text NOT NULL CHECK (platform IN ('rentcafe', 'appfolio', 'entrata', 'unknown')),
  name           text NOT NULL,
  website_url    text NOT NULL UNIQUE,
  endpoint_config jsonb NOT NULL DEFAULT '{}',
  robots_policy  jsonb,
  rate_limit_rps numeric NOT NULL DEFAULT 1,
  enabled        boolean NOT NULL DEFAULT true,
  last_scraped_at timestamptz,
  failure_streak int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE raw_snapshots (
  id                bigserial PRIMARY KEY,
  source_id         int NOT NULL REFERENCES sources(id),
  fetched_at        timestamptz NOT NULL DEFAULT now(),
  content_hash      text NOT NULL,
  payload           jsonb NOT NULL,
  processing_status text NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'processed', 'failed', 'skipped_unchanged')),
  error             text
);

CREATE INDEX raw_snapshots_source_fetched
  ON raw_snapshots (source_id, fetched_at DESC);
CREATE INDEX raw_snapshots_source_hash
  ON raw_snapshots (source_id, content_hash);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aptv2/db test -- schema-sources`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/0001_sources_and_snapshots.sql packages/db/test/schema-sources.test.ts
git commit -m "feat: add sources and raw_snapshots schema"
```

---

### Task 4: Migration 0002 — neighborhoods, properties, units

**Files:**
- Create: `packages/db/migrations/0002_geo_entities.sql`
- Test: `packages/db/test/schema-geo.test.ts`

**Interfaces:**
- Consumes: migration 0001 (references `sources`).
- Produces: tables `neighborhoods`, `properties`, `units` exactly as below; unit kinds `'floorplan' | 'unit'`; `properties.normalized_address` is the dedup identity key (unique). Plan 3 (pipeline) upserts into all three.

- [ ] **Step 1: Write the failing test**

`packages/db/test/schema-geo.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '../src/test-helpers.js'

let pool: Pool
beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await resetTestDb(pool)
})
afterAll(async () => {
  await pool.end()
})

describe('geo entity schema', () => {
  it('stores a neighborhood polygon and finds a point inside it', async () => {
    await pool.query(
      `INSERT INTO neighborhoods (metro, name, aliases, boundary)
       VALUES ('orlando', 'Downtown', ARRAY['downtown', 'downtown orlando'],
         ST_GeogFromText('MULTIPOLYGON(((-81.40 28.53, -81.36 28.53, -81.36 28.56, -81.40 28.56, -81.40 28.53)))'))`,
    )
    const { rows } = await pool.query(
      `SELECT name FROM neighborhoods
       WHERE ST_Covers(boundary, ST_GeogFromText('POINT(-81.38 28.54)'))`,
    )
    expect(rows.map((r) => r.name)).toEqual(['Downtown'])
  })

  it('creates a property with location and unique normalized address', async () => {
    const insert = `INSERT INTO properties
        (name, address_line1, city, state, zip, normalized_address, location)
       VALUES ('The Vue', '150 E Robinson St', 'Orlando', 'FL', '32801',
               '150 e robinson st orlando fl 32801',
               ST_GeogFromText('POINT(-81.376 28.545)'))
       RETURNING id`
    const { rows } = await pool.query(insert)
    expect(rows[0].id).toBeGreaterThan(0)
    await expect(pool.query(insert)).rejects.toThrow(/duplicate key/)
  })

  it('creates a floorplan and a unit referencing it', async () => {
    const { rows: props } = await pool.query(`SELECT id FROM properties LIMIT 1`)
    const { rows: fp } = await pool.query(
      `INSERT INTO units (property_id, kind, external_id, name, beds, baths, sqft)
       VALUES ($1, 'floorplan', 'A2', 'A2', 2, 2, 1100) RETURNING id`,
      [props[0].id],
    )
    const { rows: unit } = await pool.query(
      `INSERT INTO units (property_id, kind, floorplan_id, external_id, name, beds, baths, sqft)
       VALUES ($1, 'unit', $2, '304', '#304', 2, 2, 1100) RETURNING *`,
      [props[0].id, fp[0].id],
    )
    expect(unit[0].floorplan_id).toBe(fp[0].id)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aptv2/db test -- schema-geo`
Expected: FAIL — relation "neighborhoods" does not exist.

- [ ] **Step 3: Write the migration**

`packages/db/migrations/0002_geo_entities.sql`:

```sql
CREATE TABLE neighborhoods (
  id       serial PRIMARY KEY,
  metro    text NOT NULL DEFAULT 'orlando',
  name     text NOT NULL,
  aliases  text[] NOT NULL DEFAULT '{}',
  boundary geography(MultiPolygon, 4326) NOT NULL,
  UNIQUE (metro, name)
);
CREATE INDEX neighborhoods_boundary ON neighborhoods USING GIST (boundary);

CREATE TABLE properties (
  id                 serial PRIMARY KEY,
  source_id          int REFERENCES sources(id),
  name               text NOT NULL,
  address_line1      text NOT NULL,
  city               text NOT NULL,
  state              text NOT NULL,
  zip                text NOT NULL,
  normalized_address text NOT NULL UNIQUE,
  location           geography(Point, 4326) NOT NULL,
  neighborhood_id    int REFERENCES neighborhoods(id),
  amenities          text[] NOT NULL DEFAULT '{}',
  photo_urls         text[] NOT NULL DEFAULT '{}',
  management_company text,
  website_url        text,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX properties_location ON properties USING GIST (location);

CREATE TABLE units (
  id           serial PRIMARY KEY,
  property_id  int NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('floorplan', 'unit')),
  floorplan_id int REFERENCES units(id),
  external_id  text NOT NULL,
  name         text,
  beds         numeric,
  baths        numeric,
  sqft         int,
  amenities    text[] NOT NULL DEFAULT '{}',
  UNIQUE (property_id, kind, external_id)
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aptv2/db test -- schema-geo`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/0002_geo_entities.sql packages/db/test/schema-geo.test.ts
git commit -m "feat: add neighborhoods, properties, units schema"
```

---

### Task 5: Migration 0003 — listings with FTS and geo search

**Files:**
- Create: `packages/db/migrations/0003_listings.sql`
- Test: `packages/db/test/schema-listings.test.ts`

**Interfaces:**
- Consumes: migrations 0001–0002.
- Produces: table `listings` exactly as below. `search_tsv` is a stored generated column over `search_text` — populate `search_text`, never write `search_tsv`. Statuses `'active' | 'stale' | 'gone'`; lease terms `'short' | 'long' | 'both' | 'unknown'`. Prices are integer cents. Plan 3 writes listings; Plan 4's `SearchService` reads them.

- [ ] **Step 1: Write the failing test**

`packages/db/test/schema-listings.test.ts`:

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
     VALUES ('The Vue', '150 E Robinson St', 'Orlando', 'FL', '32801',
             '150 e robinson st orlando fl 32801', ST_GeogFromText('POINT(-81.376 28.545)'))
     RETURNING id`,
  )
  propertyId = p[0].id
  const { rows: u } = await pool.query(
    `INSERT INTO units (property_id, kind, external_id, beds, baths, sqft)
     VALUES ($1, 'floorplan', 'A2', 2, 2, 1100) RETURNING id`,
    [propertyId],
  )
  unitId = u[0].id
})
afterAll(async () => {
  await pool.end()
})

describe('listings schema', () => {
  it('inserts a listing and auto-generates the tsvector', async () => {
    const { rows } = await pool.query(
      `INSERT INTO listings
         (unit_id, property_id, location, price_cents, search_text)
       VALUES ($1, $2, ST_GeogFromText('POINT(-81.376 28.545)'), 185000,
               'Furnished two bedroom with pool view, walkable to Lake Eola')
       RETURNING *`,
      [unitId, propertyId],
    )
    expect(rows[0].status).toBe('active')
    expect(rows[0].price_is_starting_at).toBe(false)
    expect(rows[0].price_history).toEqual([])
    expect(rows[0].search_tsv).toContain('furnish')
  })

  it('matches FTS queries against search_tsv', async () => {
    const { rows } = await pool.query(
      `SELECT id FROM listings
       WHERE search_tsv @@ plainto_tsquery('english', 'furnished pool')`,
    )
    expect(rows.length).toBe(1)
  })

  it('finds listings within a radius', async () => {
    const { rows } = await pool.query(
      `SELECT id FROM listings
       WHERE ST_DWithin(location, ST_GeogFromText('POINT(-81.38 28.54)'), 2000)`,
    )
    expect(rows.length).toBe(1)
  })

  it('rejects invalid status values', async () => {
    await expect(
      pool.query(`UPDATE listings SET status = 'leased'`),
    ).rejects.toThrow(/violates check constraint/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aptv2/db test -- schema-listings`
Expected: FAIL — relation "listings" does not exist.

- [ ] **Step 3: Write the migration**

`packages/db/migrations/0003_listings.sql`:

```sql
CREATE TABLE listings (
  id                       bigserial PRIMARY KEY,
  unit_id                  int NOT NULL REFERENCES units(id),
  property_id              int NOT NULL REFERENCES properties(id),
  neighborhood_id          int REFERENCES neighborhoods(id),
  location                 geography(Point, 4326),
  price_cents              int,
  price_is_starting_at     boolean NOT NULL DEFAULT false,
  net_effective_rent_cents int,
  concessions_text         text,
  available_on             date,
  lease_term               text NOT NULL DEFAULT 'unknown'
    CHECK (lease_term IN ('short', 'long', 'both', 'unknown')),
  furnished                boolean,
  status                   text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'stale', 'gone')),
  first_listed_at          timestamptz NOT NULL DEFAULT now(),
  last_confirmed_at        timestamptz NOT NULL DEFAULT now(),
  price_history            jsonb NOT NULL DEFAULT '[]',
  price_changes            int NOT NULL DEFAULT 0,
  trust_score              real NOT NULL DEFAULT 0,
  freshness_score          real NOT NULL DEFAULT 0,
  search_text              text,
  search_tsv               tsvector GENERATED ALWAYS AS
    (to_tsvector('english', coalesce(search_text, ''))) STORED
);

CREATE INDEX listings_search_tsv ON listings USING GIN (search_tsv);
CREATE INDEX listings_location ON listings USING GIST (location);
CREATE INDEX listings_active_filter
  ON listings (status, neighborhood_id, price_cents);
CREATE INDEX listings_unit ON listings (unit_id);
```

Note: the spec (§4) says "tsvector maintained by trigger"; a stored generated column is the modern equivalent with identical behavior and less code — treat this as the implementation of that requirement.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aptv2/db test -- schema-listings`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/0003_listings.sql packages/db/test/schema-listings.test.ts
git commit -m "feat: add listings schema with generated tsvector and geo indexes"
```

---

### Task 6: Migration 0004 — ops tables (scrape_runs, search_logs, query_parses, review_queue)

**Files:**
- Create: `packages/db/migrations/0004_ops_tables.sql`
- Test: `packages/db/test/schema-ops.test.ts`

**Interfaces:**
- Consumes: migration 0001 (references `sources`).
- Produces: tables exactly as below. Plan 2 writes `scrape_runs`; Plan 3 writes `review_queue`; Plan 4 reads/writes `search_logs` and `query_parses` (cache keyed on `normalized_query`).

- [ ] **Step 1: Write the failing test**

`packages/db/test/schema-ops.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '../src/test-helpers.js'

let pool: Pool
beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await resetTestDb(pool)
})
afterAll(async () => {
  await pool.end()
})

describe('ops tables', () => {
  it('records a scrape run', async () => {
    const { rows: src } = await pool.query(
      `INSERT INTO sources (platform, name, website_url)
       VALUES ('appfolio', 'Test Mgmt', 'https://test.appfolio.com/listings')
       RETURNING id`,
    )
    const { rows } = await pool.query(
      `INSERT INTO scrape_runs (source_id, status, listings_found, listings_changed)
       VALUES ($1, 'ok', 42, 3) RETURNING *`,
      [src[0].id],
    )
    expect(rows[0].listings_found).toBe(42)
  })

  it('logs a search and caches a parse', async () => {
    await pool.query(
      `INSERT INTO search_logs (raw_query, parsed_filters, parse_source, result_count)
       VALUES ('furnished downtown under 2k', '{"price_max": 2000}'::jsonb, 'llm', 17)`,
    )
    await pool.query(
      `INSERT INTO query_parses (normalized_query, parsed_filters)
       VALUES ('furnished downtown under 2k', '{"price_max": 2000}'::jsonb)`,
    )
    const { rows } = await pool.query(
      `SELECT parsed_filters FROM query_parses
       WHERE normalized_query = 'furnished downtown under 2k'`,
    )
    expect(rows[0].parsed_filters).toEqual({ price_max: 2000 })
  })

  it('enqueues an ambiguous dedup match for review', async () => {
    const { rows } = await pool.query(
      `INSERT INTO review_queue (kind, payload)
       VALUES ('dedup_match', '{"candidate_a": 1, "candidate_b": 2}'::jsonb)
       RETURNING status`,
    )
    expect(rows[0].status).toBe('pending')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aptv2/db test -- schema-ops`
Expected: FAIL — relation "scrape_runs" does not exist.

- [ ] **Step 3: Write the migration**

`packages/db/migrations/0004_ops_tables.sql`:

```sql
CREATE TABLE scrape_runs (
  id               bigserial PRIMARY KEY,
  source_id        int NOT NULL REFERENCES sources(id),
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  status           text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'ok', 'failed', 'partial')),
  listings_found   int NOT NULL DEFAULT 0,
  listings_changed int NOT NULL DEFAULT 0,
  error            text
);
CREATE INDEX scrape_runs_source ON scrape_runs (source_id, started_at DESC);

CREATE TABLE search_logs (
  id                  bigserial PRIMARY KEY,
  created_at          timestamptz NOT NULL DEFAULT now(),
  raw_query           text NOT NULL,
  parsed_filters      jsonb,
  parse_source        text NOT NULL CHECK (parse_source IN ('cache', 'llm', 'fallback')),
  result_count        int,
  clicked_listing_ids bigint[] NOT NULL DEFAULT '{}'
);

CREATE TABLE query_parses (
  normalized_query text PRIMARY KEY,
  parsed_filters   jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  hit_count        int NOT NULL DEFAULT 1
);

CREATE TABLE review_queue (
  id         serial PRIMARY KEY,
  kind       text NOT NULL,
  payload    jsonb NOT NULL,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aptv2/db test -- schema-ops`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full migration set against the dev database and commit**

Run: `pnpm --filter @aptv2/db migrate`
Expected: `Applied: 0001_sources_and_snapshots.sql, 0002_geo_entities.sql, 0003_listings.sql, 0004_ops_tables.sql`

```bash
git add packages/db/migrations/0004_ops_tables.sql packages/db/test/schema-ops.test.ts
git commit -m "feat: add scrape_runs, search_logs, query_parses, review_queue schema"
```

---

### Task 7: Worker process with pg-boss

**Files:**
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/vitest.config.ts`, `apps/worker/test/setup.ts`
- Create: `apps/worker/src/boss.ts`, `apps/worker/src/jobs/heartbeat.ts`, `apps/worker/src/index.ts`
- Test: `apps/worker/test/queue.test.ts`

**Interfaces:**
- Consumes: `TEST_DATABASE_URL`/`DATABASE_URL` env; db schema (pg-boss creates its own `pgboss` schema).
- Produces: `createBoss(connectionString: string): PgBoss` (constructed, not started); `registerJobs(boss: PgBoss): Promise<void>` (creates queues and attaches workers — Plan 2 adds scrape jobs here); job name constant `HEARTBEAT = 'heartbeat'`; `pnpm --filter @aptv2/worker dev` runs the worker.

- [ ] **Step 1: Write worker package scaffold**

`apps/worker/package.json`:

```json
{
  "name": "@aptv2/worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@aptv2/db": "workspace:*",
    "pg-boss": "^10.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0",
    "tsx": "^4.19.0",
    "dotenv": "^16.4.0"
  }
}
```

`apps/worker/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

`apps/worker/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
    testTimeout: 30000,
  },
})
```

`apps/worker/test/setup.ts`:

```ts
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing queue round-trip test**

`apps/worker/test/queue.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { createBoss } from '../src/boss'
import { registerJobs, HEARTBEAT } from '../src/jobs/heartbeat'

const boss = createBoss(process.env.TEST_DATABASE_URL!)

afterAll(async () => {
  await boss.stop({ graceful: false })
})

describe('pg-boss queue', () => {
  it('round-trips a heartbeat job', async () => {
    await boss.start()
    await registerJobs(boss)

    let resolve!: (v: unknown) => void
    const handled = new Promise((r) => (resolve = r))
    await boss.work(HEARTBEAT, async ([job]) => {
      resolve(job!.data)
    })

    await boss.send(HEARTBEAT, { ping: 1 })
    const data = await handled
    expect(data).toEqual({ ping: 1 })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @aptv2/worker test`
Expected: FAIL — cannot find `../src/boss`.

- [ ] **Step 4: Implement boss factory, heartbeat job, and worker entry**

`apps/worker/src/boss.ts`:

```ts
import PgBoss from 'pg-boss'

export function createBoss(connectionString: string): PgBoss {
  return new PgBoss({ connectionString })
}
```

`apps/worker/src/jobs/heartbeat.ts`:

```ts
import type PgBoss from 'pg-boss'

export const HEARTBEAT = 'heartbeat'

export async function registerJobs(boss: PgBoss): Promise<void> {
  await boss.createQueue(HEARTBEAT)
}
```

`apps/worker/src/index.ts`:

```ts
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { createBoss } from './boss'
import { registerJobs, HEARTBEAT } from './jobs/heartbeat'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

const boss = createBoss(url)
boss.on('error', (err) => console.error('[pg-boss]', err))

await boss.start()
await registerJobs(boss)
await boss.work(HEARTBEAT, async ([job]) => {
  console.log('[heartbeat]', job!.id, job!.data)
})
await boss.schedule(HEARTBEAT, '*/15 * * * *', {})
console.log('Worker started; heartbeat scheduled every 15 minutes')
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @aptv2/worker test`
Expected: PASS (1 test).

- [ ] **Step 6: Verify the worker boots against the dev database**

Run: `pnpm --filter @aptv2/worker dev` (stop with Ctrl+C after the startup line prints)
Expected: `Worker started; heartbeat scheduled every 15 minutes`

- [ ] **Step 7: Commit**

```bash
git add apps/worker pnpm-lock.yaml
git commit -m "feat: add pg-boss worker process with scheduled heartbeat"
```

---

### Task 8: Next.js web skeleton with DB health endpoint

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/vitest.config.ts`, `apps/web/test/setup.ts`
- Create: `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/app/api/health/route.ts`
- Test: `apps/web/test/health.test.ts`

**Interfaces:**
- Consumes: `getPool`, `closePool` from `@aptv2/db`.
- Produces: Next.js app at `apps/web` (`pnpm --filter @aptv2/web dev`); `GET /api/health` → `{ ok: true, db: "up" }` (200) or `{ ok: false, db: "down" }` (503). Plan 4 adds the search API and UI to this app.

- [ ] **Step 1: Write web package scaffold**

`apps/web/package.json`:

```json
{
  "name": "@aptv2/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@aptv2/db": "workspace:*",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0",
    "dotenv": "^16.4.0"
  }
}
```

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "plugins": [{ "name": "next" }],
    "allowJs": true,
    "incremental": true,
    "noEmit": true
  },
  "include": ["app", "test", "next-env.d.ts", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`apps/web/next.config.ts`:

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {}

export default nextConfig
```

`apps/web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
    testTimeout: 20000,
  },
})
```

`apps/web/test/setup.ts`:

```ts
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing health-route test**

The route handler is a plain async function — test it directly, pointing `DATABASE_URL` at the test database.

`apps/web/test/health.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

beforeAll(() => {
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

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @aptv2/web test`
Expected: FAIL — cannot find `../app/api/health/route.js`.

- [ ] **Step 4: Implement layout, page, and health route**

`apps/web/app/layout.tsx`:

```tsx
import type { ReactNode } from 'react'

export const metadata = { title: 'aptv2' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

`apps/web/app/page.tsx`:

```tsx
export default function Home() {
  return <main>aptv2 — coming soon</main>
}
```

`apps/web/app/api/health/route.ts`:

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

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @aptv2/web test`
Expected: PASS (1 test).

- [ ] **Step 6: Verify the dev server boots**

Run: `pnpm --filter @aptv2/web dev` in the background; then `Invoke-WebRequest http://localhost:3000/api/health | Select-Object -ExpandProperty Content`; stop the server.
Expected: `{"ok":true,"db":"up"}`

- [ ] **Step 7: Run the full suite and commit**

Run: `pnpm test` then `pnpm typecheck`
Expected: all packages pass.

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat: add next.js web skeleton with db health endpoint"
```
