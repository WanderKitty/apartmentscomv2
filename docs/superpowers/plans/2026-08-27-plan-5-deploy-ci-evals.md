# Plan 5: Deploy + CI + AI Evals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Three tasks have USER-INTERACTIVE GATES (GitHub auth, Neon account, Vercel auth) — the implementer STOPs with NEEDS_CONTEXT at a gate and the controller relays to the user.

**Goal:** The Orlando aggregator publicly reachable on a free-tier stack — Vercel (apps/web) + Neon Postgres/PostGIS (real-only corpus: neighborhoods + sources seeded, ZERO seed listings) + GitHub Actions (CI on every push; scheduled scraping 3×/day; AI evals on master + nightly) — plus a zero-results relaxation-hints feature and a documented teardown checklist for the ~1-week demo window.

**Architecture:** The repo goes to a **private** GitHub repository; three workflows own automation: `ci.yml` (typecheck + full suites against a PostGIS service container + web build, every push), `scrape.yml` (cron 3×/day + manual dispatch running `scrape-all` against Neon with tri-state exit codes so ANY source failure reds the run), `evals.yml` (master-merge + nightly: a ~50-query golden parse regression against live Haiku with per-field accuracy thresholds, an extraction-sampling eval judged by a stronger model against fixture source texts, and a deterministic results-satisfy-filters sweep). Vercel builds `apps/web` from the repo (Root Directory = apps/web; pnpm workspace + existing `transpilePackages` handle the TS-source packages); Neon's POOLED connection string feeds Vercel (single-statement queries are transaction-pool-safe) while the DIRECT string is used once from this machine for migrate + prod seed. The first cloud scrape run is the **egress gate**: if GitHub runners cannot reach the Entrata sites, the fallback (local scheduled scrape writing to Neon) is a recorded controller decision, not an improvisation.

**Tech Stack:** Existing monorepo (pnpm, Node ≥22, TS strict, Vitest, Next 16.3.3) + GitHub CLI (`gh`), Vercel CLI, Neon (managed Postgres 17 + PostGIS), GitHub Actions (`pnpm/action-setup`, `postgis/postgis:17-3.5` service). New package `packages/evals` (vitest, `@anthropic-ai/sdk`, zod — all already in the workspace).

**Spec:** `docs/superpowers/specs/2026-08-27-apartment-aggregator-design.md` (§8 ops/testing; §6 search; §7 compliance — unchanged posture, new egress origin). Standing user rulings (2026-08-27): free-tier stack approved (Vercel/Neon/Actions, key on Vercel); prod corpus is REAL listings only; ~1-week public window with teardown; vitest live-eval tooling; deploy-first-then-scale sequencing.

## Global Constraints

- Work in the main checkout. Integration branch `plan5-integration` off `master`; task branches `task/p5-<n>-<slug>` merged back `--no-ff`. Master merge at the end if green (controller; standing ruling). NOTE: once the GitHub remote exists (Task 1), pushing `master` triggers CI + Vercel — treat every master merge as a deploy.
- **Secrets discipline (binding):** connection strings and API keys are NEVER printed into reports, logs, commit messages, or tool output summaries. They live in: the user's gitignored `.env.deploy` at repo root (user-created), GitHub Actions secrets (set via `gh secret set NAME < file` or user-run commands), and Vercel env vars (user-run `vercel env add`). An implementer that needs a secret value reads it from `.env.deploy` into a shell variable and passes it on — never echoes it. Verify `.env`, `.env.deploy`, `.env*.local` are gitignored BEFORE the first push.
- **Compliance §7 unchanged:** production scraping goes through the same politeness fetcher (robots, ≤1 req/s, UA `aptv2-research-bot/0.1 (+mailto:volodolzh@gmail.com)`, crawl-delay-aware retries). Never characterize any site's protective measures anywhere; if runners can't reach a site, "not publicly reachable from the runner environment" is the entire permitted description. Live-run reports paste VERBATIM output (standing ruling from Plan 4's Task 7).
- **Prod corpus is real-only:** Neon gets migrations + `seed:prod` (neighborhoods + sources ONLY). `buildSeedUnits` listings never reach prod. Local/CI keep the full seed.
- Eval models: parser under test is `claude-haiku-4-5` (unchanged); the extraction judge is `claude-sonnet-5`. Eval suites are skip-gated on `ANTHROPIC_API_KEY` so `pnpm -r test` stays green without a key; the evals workflow provides it.
- Windows locally; workflows run ubuntu. Brief commands are bash via the Bash tool. `noUncheckedIndexedAccess` — minimal `!` on guarded accesses, listed per report.
- End every commit message (incl. merges) with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- **Plan 4 carry-overs deliberately OUT of scope** (owned by Plan 6): variant-2 embedded extractor, robots `Allow`/wildcard support, `rate_limit_rps` wiring, seed-vs-ops `enabled` overwrite, snapshot storage economy, batched cache SELECTs, city filter.

---

### Task 1: Private GitHub repo + push + CI workflow

**USER-INTERACTIVE GATE:** requires `gh auth status` to succeed. If it fails, STOP (NEEDS_CONTEXT): the controller asks the user to run `! gh auth login` (and to install `gh` first if absent — `winget install GitHub.cli`).

**Files:**
- Create: `.github/workflows/ci.yml`, root `README.md` (short: what this is, pointer to `apps/web/README.md`, private-repo note)
- Verify (no change unless missing): root `.gitignore` covers `.env`, `.env.deploy`, `.env*.local`, `.superpowers/`, `node_modules`, `.next`

**Interfaces:** Produces the `origin` remote, a green `ci.yml` run on GitHub, and the repo name Tasks 5–7 reference. Repo name: `apartmentscomv2`, private, under the user's account.

- [ ] **Step 1: Branch + gate check**

```bash
cd X:/apartmentscomv2
gh auth status || echo "GATE: STOP - report NEEDS_CONTEXT"
git checkout master && git checkout -b plan5-integration && git checkout -b task/p5-1-repo-ci
```

- [ ] **Step 2: Gitignore audit (BEFORE any push)**

Confirm each of `.env`, `.env.deploy`, `.env*.local`, `.superpowers/`, `.playwright-mcp/`, `demo-page.png` is either gitignored or intentionally tracked; `git status --porcelain` must show no secret-bearing file as untracked-and-pushable. Add missing patterns to `.gitignore`. Also confirm `git ls-files | grep -E '\.env'` returns only `.env.example`.

- [ ] **Step 3: CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: ["**"]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      db:
        image: postgis/postgis:17-3.5
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: aptv2_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres" --health-interval 5s
          --health-timeout 5s --health-retries 10
    env:
      TEST_DATABASE_URL: postgres://postgres:postgres@localhost:5432/aptv2_test
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/aptv2_test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r typecheck
      - run: pnpm -r --if-present test
      - run: pnpm --filter @aptv2/web build
```

(Test setups load the root `.env` via dotenv — absent in CI, a no-op; the env block above supplies the URLs. `resetTestDb` applies migrations per suite, so no migrate step is needed.)

- [ ] **Step 4: Root README**

Short and framing-compliant: project one-liner, "see `apps/web/README.md` for the full runbook", the three workflows in a sentence each, PRIVATE-repo note (captured fixtures + demo project).

- [ ] **Step 5: Create repo, push, verify CI**

```bash
git add -A && git commit -m "ci: GitHub Actions test workflow + root README"
git checkout plan5-integration && git merge --no-ff task/p5-1-repo-ci
gh repo create apartmentscomv2 --private --source . --remote origin
git push -u origin master plan5-integration
gh run watch --exit-status $(gh run list --branch plan5-integration --limit 1 --json databaseId -q '.[0].databaseId')
```

Expected: CI green on the first run (fix forward on the task branch if the runner surfaces environment drift — e.g. line-ending or path assumptions — each fix is a commit, re-verified). Record the run URL in the report.

- [ ] **Step 6: Commit/merge bookkeeping**

Already merged in Step 5 (repo creation needed the branch state). Report the repo URL + CI run URL.

---

### Task 2: Prod-seed CLI + scrape-all exit codes

**Files:**
- Create: `packages/pipeline/src/seed-prod-cli.ts`
- Modify: `packages/pipeline/package.json` (script `"seed:prod": "tsx src/seed-prod-cli.ts"`), `apps/worker/src/scrape-all.ts` (tri-state exit), `apps/worker/test/scrape.test.ts` (cover the summary logic if extracted — see below)

**Interfaces:** Produces `seed:prod` (neighborhoods + sources ONLY — zero listings) and `scrape-all` exit semantics: 0 = all enabled sources succeeded, 2 = some failed, 1 = all failed. Task 5 runs `seed:prod` against Neon; Task 7's workflow relies on nonzero-on-any-failure.

- [ ] **Step 1: Branch; write seed-prod-cli**

```bash
git checkout plan5-integration && git checkout -b task/p5-2-prod-prep
```

`packages/pipeline/src/seed-prod-cli.ts` (mirrors `seed-cli.ts`, minus listings):

```ts
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { getPool, closePool } from '@aptv2/db'
import { seedNeighborhoods } from './neighborhoods'
import { seedSources } from './sources-seed'

// Production seeding: geography + source registry ONLY. Listings arrive
// exclusively through the scrape pipeline (user ruling: prod corpus is
// real scraped data, never demo seed rows).
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

const pool = getPool()
const hoods = await seedNeighborhoods(pool)
const sources = await seedSources(pool)
const { rows } = await pool.query(`SELECT count(*)::int AS n FROM listings WHERE provenance = 'seed'`)
console.log(`Seeded ${hoods} neighborhoods, ${sources} sources; seed listings in DB: ${rows[0].n} (must be 0)`)
await closePool()
if (rows[0].n !== 0) process.exit(1)
```

Add the `seed:prod` script. Verify locally: run against the DEV database — it prints the counts and exits 1 (dev has 26 seed listings — that exit-1 is the guard proving itself; state this in the report).

- [ ] **Step 2: scrape-all tri-state exit**

In `apps/worker/src/scrape-all.ts`, replace the exit logic: track `succeeded`/`failed` counts; after the loop print the per-source summary then `process.exit(failed === 0 ? 0 : succeeded === 0 ? 1 : 2)`. Comment: "Actions treats any nonzero as a red run — for a 2-source demo, any failure should alert." Keep everything else identical. If the counting logic stays inline (no new exported function), typecheck-only is acceptable — the DoD's cloud run exercises it; say which in the report.

- [ ] **Step 3: GREEN + commit + merge**

`pnpm -r typecheck`, `pnpm --filter @aptv2/pipeline test`, `pnpm --filter @aptv2/worker test` → green.

```bash
git add -A && git commit -m "feat: prod-only seeding CLI and tri-state scrape-all exit codes"
git checkout plan5-integration && git merge --no-ff task/p5-2-prod-prep
git push origin plan5-integration
```

---

### Task 3: Zero-results relaxation hints

When a search returns 0 listings with at least one filter active, tell the visitor which single filter removal would yield results, with counts — transparency-as-UX, matching the parse-echo ethos. (Origin: the user hit `furnished 1br near Lake Eola under $2,000` → silent 0.)

**Files:**
- Modify: `packages/schema/src/types.ts` (`SearchResult` gains `relaxationHints`), `packages/search/src/postgres-search.ts` (compute hints on zero results), `apps/web/app/page.tsx` (render hints), `apps/web/lib/types.ts` (shim untouched — re-export covers it)
- Test: `packages/search/test/postgres-search.test.ts` (hint math), `apps/web` component-level render is covered by the page being an integration surface — assert hint STRINGS via the search test; page rendering verified in DoD.

**Interfaces:** `SearchResult.relaxationHints: Array<{ drop: string; label: string; count: number; suggestedQuery: string }>` — empty array unless `totalCount === 0` and ≥1 filter was active.

- [ ] **Step 1: Branch; failing test**

```bash
git checkout plan5-integration && git checkout -b task/p5-3-relaxation-hints
```

Add to `packages/search/test/postgres-search.test.ts`:

```ts
  it('offers single-filter relaxation hints on zero results', async () => {
    // Seed corpus has no furnished listings: furnished:true zeroes any query.
    const p: ParsedQuery = {
      ...parseQueryKeywords('1 bed under $2000 near lake eola'),
      furnished: true,
    }
    const svc = createSearchService(() => pool, { parse: async () => p })
    const r = await svc.search('furnished 1br near Lake Eola under $2,000')
    expect(r.totalCount).toBe(0)
    expect(r.relaxationHints.length).toBeGreaterThanOrEqual(1)
    const furnishedHint = r.relaxationHints.find((h) => h.drop === 'furnished')!
    expect(furnishedHint.count).toBeGreaterThanOrEqual(1)
    expect(furnishedHint.label).toMatch(/Furnished/)
    expect(furnishedHint.suggestedQuery).not.toMatch(/furnished/i)
    // Hints are sorted by count descending and only include productive drops.
    for (const h of r.relaxationHints) expect(h.count).toBeGreaterThan(0)
  })

  it('returns no hints when results exist', async () => {
    const r = await service().search('1 bed')
    expect(r.relaxationHints).toEqual([])
  })
```

RED first.

- [ ] **Step 2: Implement**

In `postgres-search.ts`:
- Type: add `relaxationHints` to `SearchResult` in `packages/schema/src/types.ts` (with a doc comment).
- After collapse, when `collapsed.length === 0` and at least one of (neighborhoods, priceMax, bedsMin, furnished, shortTerm, amenities[i]) is active: for each active filter, re-run a COUNT variant of the inner query with that ONE filter neutralized (extract a helper `countMatching(pool, parsed, dropKey)` that builds the same WHERE with the dropped field nulled/emptied — reuse the existing SQL by parameter substitution, not string surgery: passing `null`/`[]`/`''` for the dropped filter's parameters against a `SELECT count(*)` version of the inner query). Each amenity is dropped individually (`drop: 'amenity:pool'`).
- `label`: human name ("Furnished", "Under $2,000", "2+ bd", "Lake Eola Heights", "pool"). `suggestedQuery`: rebuild a natural query string from the REMAINING filters (order: beds → "in {first neighborhood}" → "under ${price}" → amenities → "furnished"/"short term") — lossy reconstruction is fine; it must parse back to the remaining filters under the keyword rung (assert that in the test for one case if cheap).
- Keep only hints with `count > 0`, sort by count desc, cap at 4. Zero extra queries on the non-empty path.

In `apps/web/app/page.tsx`, under the existing "0 listings" state: render each hint as a link to `/?q=${encodeURIComponent(h.suggestedQuery)}` with the copy `removing {label} shows {count} listing{s}`. Match existing Tailwind tokens; consult the Next 16 docs note before editing.

- [ ] **Step 3: GREEN + commit + merge + push**

Search suite + web suite + typecheck + build green.

```bash
git add -A && git commit -m "feat: zero-results relaxation hints with counts and suggested queries"
git checkout plan5-integration && git merge --no-ff task/p5-3-relaxation-hints && git push origin plan5-integration
```

---

### Task 4: `packages/evals` — golden parse regression, extraction judge, filter-satisfaction sweep + evals workflow

**Files:**
- Create: `packages/evals/package.json`, `tsconfig.json`, `vitest.config.ts`, `test/setup.ts` (root-.env dotenv), `src/goldens.ts`, `test/parse-goldens.eval.test.ts`, `test/extraction-judge.eval.test.ts`, `test/filters-satisfied.test.ts`, `.github/workflows/evals.yml`

**Interfaces:** Suites runnable as `pnpm --filter @aptv2/evals test`. The two `.eval.` suites skip cleanly without `ANTHROPIC_API_KEY`; `filters-satisfied` needs only `TEST_DATABASE_URL`. Thresholds are the CI gate: hard fields (priceMax, bedsMin) ≥ 0.95 accuracy; neighborhoods/furnished/shortTerm ≥ 0.90; amenities set-equality ≥ 0.85; extraction judge: zero `contradicted` verdicts across the sample.

- [ ] **Step 1: Branch + scaffold**

```bash
git checkout plan5-integration && git checkout -b task/p5-4-evals
```

`packages/evals/package.json`:

```json
{
  "name": "@aptv2/evals",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "devDependencies": {
    "@anthropic-ai/sdk": "^0.121.0",
    "@aptv2/db": "workspace:*",
    "@aptv2/pipeline": "workspace:*",
    "@aptv2/schema": "workspace:*",
    "@aptv2/scrapers": "workspace:*",
    "@aptv2/search": "workspace:*",
    "@types/node": "^22.0.0",
    "@types/pg": "^8.11.0",
    "dotenv": "^16.4.0",
    "pg": "^8.13.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0",
    "zod": "^4.4.3"
  }
}
```

tsconfig/vitest/setup mirror `packages/pipeline` (DB-shape: setupFiles, testTimeout 30000 — live API calls — `fileParallelism: false`). `pnpm install`.

- [ ] **Step 2: The golden set**

`packages/evals/src/goldens.ts` — 50 queries with expected filters. `expect` fields omitted = expected null/empty. Amenity/neighborhood names use the taxonomy exactly:

```ts
import type { ParsedQuery } from '@aptv2/schema'

export type Golden = { q: string; expect: Partial<Pick<ParsedQuery,
  'neighborhoods' | 'priceMax' | 'bedsMin' | 'furnished' | 'shortTerm' | 'amenities'>> }

export const GOLDENS: Golden[] = [
  { q: 'pet friendly 2br under $2400 near Lake Eola with in-unit laundry', expect: { neighborhoods: ['Lake Eola Heights'], priceMax: 2400, bedsMin: 2, amenities: ['pet friendly', 'in-unit laundry'] } },
  { q: '1 bed downtown under 2k', expect: { neighborhoods: ['Downtown Orlando'], priceMax: 2000, bedsMin: 1 } },
  { q: 'studio in thornton park', expect: { neighborhoods: ['Thornton Park'], bedsMin: 0 } },
  { q: 'furnished 1br near lake eola under $2,000', expect: { neighborhoods: ['Lake Eola Heights'], priceMax: 2000, bedsMin: 1, furnished: true } },
  { q: 'two bedroom two bath with a pool in baldwin park', expect: { neighborhoods: ['Baldwin Park'], bedsMin: 2, amenities: ['pool'] } },
  { q: 'cheap studio mills 50', expect: { neighborhoods: ['Mills 50'], bedsMin: 0 } },
  { q: '3 bedroom college park max $2600', expect: { neighborhoods: ['College Park'], priceMax: 2600, bedsMin: 3 } },
  { q: 'apartments in sodo with parking', expect: { neighborhoods: ['SoDo'], amenities: ['parking'] } },
  { q: 'short term furnished place downtown orlando', expect: { neighborhoods: ['Downtown Orlando'], furnished: true, shortTerm: true } },
  { q: 'month to month lease near audubon park', expect: { neighborhoods: ['Audubon Park'], shortTerm: true } },
  { q: 'dog friendly 1 bedroom under 1800', expect: { priceMax: 1800, bedsMin: 1, amenities: ['pet friendly'] } },
  { q: 'gym and pool 2br', expect: { bedsMin: 2, amenities: ['gym', 'pool'] } },
  { q: 'washer dryer in unit 2 bed thornton park', expect: { neighborhoods: ['Thornton Park'], bedsMin: 2, amenities: ['in-unit laundry'] } },
  { q: 'balcony apartment lake eola heights', expect: { neighborhoods: ['Lake Eola Heights'], amenities: ['balcony'] } },
  { q: 'under $1500 anywhere', expect: { priceMax: 1500 } },
  { q: 'unfurnished 2 bedroom', expect: { bedsMin: 2, furnished: false } },
  { q: '1br with garage college park', expect: { neighborhoods: ['College Park'], bedsMin: 1, amenities: ['parking'] } },
  { q: 'eola area below 2200 with fitness center', expect: { neighborhoods: ['Lake Eola Heights'], priceMax: 2200, amenities: ['gym'] } },
  { q: 'cats ok studio under 1600', expect: { priceMax: 1600, bedsMin: 0, amenities: ['pet friendly'] } },
  { q: 'baldwin park 2 bed 2 bath under $2,500 pool', expect: { neighborhoods: ['Baldwin Park'], priceMax: 2500, bedsMin: 2, amenities: ['pool'] } },
  { q: 'downtown high rise 1 bedroom', expect: { neighborhoods: ['Downtown Orlando'], bedsMin: 1 } },
  { q: 'mills fifty one bed with laundry', expect: { neighborhoods: ['Mills 50'], bedsMin: 1, amenities: ['in-unit laundry'] } },
  { q: 'three bed house style audubon park under 2800', expect: { neighborhoods: ['Audubon Park'], priceMax: 2800, bedsMin: 3 } },
  { q: 'sodo studio short term', expect: { neighborhoods: ['SoDo'], bedsMin: 0, shortTerm: true } },
  { q: '2br 2ba pet friendly parking under $2300', expect: { priceMax: 2300, bedsMin: 2, amenities: ['pet friendly', 'parking'] } },
  { q: 'lake eola heights 1 bedroom balcony under 1900', expect: { neighborhoods: ['Lake Eola Heights'], priceMax: 1900, bedsMin: 1, amenities: ['balcony'] } },
  { q: 'college park furnished studio', expect: { neighborhoods: ['College Park'], bedsMin: 0, furnished: true } },
  { q: 'apartments near lake eola', expect: { neighborhoods: ['Lake Eola Heights'] } },
  { q: 'thornton park under two thousand', expect: { neighborhoods: ['Thornton Park'], priceMax: 2000 } },
  { q: '1 bedroom with dishwasher downtown', expect: { neighborhoods: ['Downtown Orlando'], bedsMin: 1 } },
  { q: 'pool gym parking 3br baldwin park', expect: { neighborhoods: ['Baldwin Park'], bedsMin: 3, amenities: ['pool', 'gym', 'parking'] } },
  { q: 'quiet 1br mills 50 max 1700', expect: { neighborhoods: ['Mills 50'], priceMax: 1700, bedsMin: 1 } },
  { q: 'dog park nearby 2 bed', expect: { bedsMin: 2, amenities: ['pet friendly'] } },
  { q: 'washer and dryer included studio sodo', expect: { neighborhoods: ['SoDo'], bedsMin: 0, amenities: ['in-unit laundry'] } },
  { q: 'month-to-month 1 bed under $2,100', expect: { priceMax: 2100, bedsMin: 1, shortTerm: true } },
  { q: 'audubon park pet friendly under 2000', expect: { neighborhoods: ['Audubon Park'], priceMax: 2000, amenities: ['pet friendly'] } },
  { q: '2 bedroom near downtown with balcony and pool', expect: { neighborhoods: ['Downtown Orlando'], bedsMin: 2, amenities: ['balcony', 'pool'] } },
  { q: 'cbd studio', expect: { neighborhoods: ['Downtown Orlando'], bedsMin: 0 } },
  { q: 'one bed one bath college park under $1,650', expect: { neighborhoods: ['College Park'], priceMax: 1650, bedsMin: 1 } },
  { q: 'furnished short term 2br lake eola', expect: { neighborhoods: ['Lake Eola Heights'], bedsMin: 2, furnished: true, shortTerm: true } },
  { q: 'gym access 1br under 1850 mills 50', expect: { neighborhoods: ['Mills 50'], priceMax: 1850, bedsMin: 1, amenities: ['gym'] } },
  { q: 'baldwin park townhome 3 bed', expect: { neighborhoods: ['Baldwin Park'], bedsMin: 3 } },
  { q: 'no more than $2000 2 bedroom thornton park', expect: { neighborhoods: ['Thornton Park'], priceMax: 2000, bedsMin: 2 } },
  { q: 'studio with parking under 1500', expect: { priceMax: 1500, bedsMin: 0, amenities: ['parking'] } },
  { q: 'south downtown 2br pool', expect: { neighborhoods: ['SoDo'], bedsMin: 2, amenities: ['pool'] } },
  { q: 'lake eola 1br laundry pet friendly under $2,050', expect: { neighborhoods: ['Lake Eola Heights'], priceMax: 2050, bedsMin: 1, amenities: ['in-unit laundry', 'pet friendly'] } },
  { q: 'unfurnished studio downtown under 1700', expect: { neighborhoods: ['Downtown Orlando'], priceMax: 1700, bedsMin: 0, furnished: false } },
  { q: '4 bedroom anywhere', expect: { bedsMin: 4 } },
  { q: 'college park 2 bed short-term', expect: { neighborhoods: ['College Park'], bedsMin: 2, shortTerm: true } },
  { q: 'two bed balcony gym audubon park under 2400', expect: { neighborhoods: ['Audubon Park'], priceMax: 2400, bedsMin: 2, amenities: ['balcony', 'gym'] } },
]
```

(Exactly 50. Ambiguous decorations — "cheap", "quiet", "high rise", "townhome", "house style", "dishwasher" (not in taxonomy) — deliberately expect NO filter: extracting only stated, mappable constraints is the behavior under test.)

- [ ] **Step 3: Golden regression suite**

`packages/evals/test/parse-goldens.eval.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { __resetParseCacheForTests, parseQuery } from '@aptv2/search'
import { GOLDENS } from '../src/goldens'

const KEY = process.env.ANTHROPIC_API_KEY

describe.skipIf(!KEY)('golden parse regression (live claude-haiku-4-5)', () => {
  it('meets per-field accuracy thresholds over the 50-query golden set', async () => {
    __resetParseCacheForTests()
    const fields = ['neighborhoods', 'priceMax', 'bedsMin', 'furnished', 'shortTerm', 'amenities'] as const
    const hits: Record<string, number> = Object.fromEntries(fields.map((f) => [f, 0]))
    const misses: string[] = []
    let llmCount = 0
    for (const g of GOLDENS) {
      const p = await parseQuery(g.q)
      if (p.parseSource === 'llm') llmCount++
      const exp = {
        neighborhoods: g.expect.neighborhoods ?? [],
        priceMax: g.expect.priceMax ?? null,
        bedsMin: g.expect.bedsMin ?? null,
        furnished: g.expect.furnished ?? null,
        shortTerm: g.expect.shortTerm ?? null,
        amenities: g.expect.amenities ?? [],
      }
      const got = {
        neighborhoods: [...p.neighborhoods].sort(),
        priceMax: p.priceMax, bedsMin: p.bedsMin, furnished: p.furnished, shortTerm: p.shortTerm,
        amenities: [...p.amenities].sort(),
      }
      for (const f of fields) {
        const ok = JSON.stringify(got[f] instanceof Array ? got[f] : got[f]) ===
                   JSON.stringify(exp[f] instanceof Array ? [...(exp[f] as string[])].sort() : exp[f])
        if (ok) hits[f]!++
        else misses.push(`${f} | "${g.q}" | expected ${JSON.stringify(exp[f])} got ${JSON.stringify(got[f])}`)
      }
    }
    const n = GOLDENS.length
    console.log(`llm-parsed: ${llmCount}/${n}`)
    console.log(misses.join('\n') || 'no field misses')
    expect(llmCount).toBeGreaterThan(n * 0.9) // the live rung must actually be exercised
    expect(hits.priceMax! / n).toBeGreaterThanOrEqual(0.95)
    expect(hits.bedsMin! / n).toBeGreaterThanOrEqual(0.95)
    expect(hits.neighborhoods! / n).toBeGreaterThanOrEqual(0.9)
    expect(hits.furnished! / n).toBeGreaterThanOrEqual(0.9)
    expect(hits.shortTerm! / n).toBeGreaterThanOrEqual(0.9)
    expect(hits.amenities! / n).toBeGreaterThanOrEqual(0.85)
  }, 300_000)
})
```

RED-check trick without spending 50 calls: temporarily set one golden's expectation wrong, run with the key, watch the miss print; revert. (State in the report whether you ran the live suite locally — it requires a key; if none is available locally, the suite's first live run happens in the evals workflow and THAT run's output is the GREEN evidence.)

- [ ] **Step 4: Extraction-sampling judge**

`packages/evals/test/extraction-judge.eval.test.ts` — sample every fixture unit with non-empty free text (cap 12), run the REAL `createHaikuEnricher`, then judge each enrichment against its source texts with `claude-sonnet-5`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { describe, expect, it } from 'vitest'
import { parseEntrataPayload } from '@aptv2/scrapers'
import { createHaikuEnricher } from '@aptv2/pipeline'

const KEY = process.env.ANTHROPIC_API_KEY

const Verdict = z.object({
  fields: z.array(z.object({
    field: z.string(),
    verdict: z.enum(['supported', 'not_in_text', 'contradicted']),
    note: z.string(),
  })),
})

describe.skipIf(!KEY)('extraction sampling judged by claude-sonnet-5', () => {
  it('no extracted field contradicts its source text', async () => {
    const payload = JSON.parse(readFileSync(
      fileURLToPath(new URL('../../scrapers/fixtures/entrata-availability.json', import.meta.url)), 'utf8'))
    const units = parseEntrataPayload(payload)
      .filter((u) => [...u.amenityTexts, ...u.marketingTexts].some((t) => t.trim()))
      .slice(0, 12)
    expect(units.length).toBeGreaterThanOrEqual(3) // sample floor; raise cap when corpus grows
    const enrich = createHaikuEnricher()!
    const judgeClient = new Anthropic()
    const contradictions: string[] = []
    for (const u of units) {
      const texts = [...u.amenityTexts, ...u.marketingTexts]
      const enrichment = await enrich(texts)
      if (!enrichment) continue // model found nothing to extract — nothing to judge
      const res = await judgeClient.messages.parse({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        system: 'You verify data extraction. For each extracted field, judge strictly against ONLY the source texts: supported (text states it), not_in_text (extractor should have said null/not_mentioned), or contradicted (text says otherwise).',
        messages: [{ role: 'user', content: `SOURCE TEXTS:\n${texts.join('\n')}\n\nEXTRACTED:\n${JSON.stringify(enrichment, null, 2)}` }],
        output_config: { format: zodOutputFormat(Verdict) },
      })
      for (const f of res.parsed_output?.fields ?? []) {
        if (f.verdict === 'contradicted') contradictions.push(`${u.externalId}.${f.field}: ${f.note}`)
      }
    }
    console.log(contradictions.join('\n') || 'no contradictions')
    expect(contradictions).toEqual([])
  }, 300_000)
})
```

(Enricher results are NOT db-cached here — `createHaikuEnricher` is pure; the pipeline's cache layer isn't in this path. If the import surface differs — e.g. enricher needs no pool — adapt minimally and state it.)

- [ ] **Step 5: Deterministic filter-satisfaction sweep**

`packages/evals/test/filters-satisfied.test.ts` — no API key needed; real Postgres; seeds the full local corpus (seed listings + both fixture extractions via `extractSnapshot` with `llm: null`), then for a battery of keyword-rung queries asserts EVERY returned listing satisfies every parsed hard filter:

queries: `['1 bed', '2br under $2200', 'studio', 'pet friendly 2br', '3 bed', 'pool gym 2 bed', '1br in thornton park', 'under 1800']` — for each result listing assert: `beds >= bedsMin` (when set); `price === null || price <= priceMax` (when set); every parsed amenity ∈ listing.amenities; `furnished === parsed.furnished` when set; `shortTermOk === parsed.shortTerm` when set. Also assert `timing.corpus === corpusSeed + corpusScraped`. Use the `createSearchService` + `parseQueryKeywords` injection pattern from the existing search tests; setup mirrors `postgres-search.test.ts` plus fixture extraction seeding (source rows inserted like the worker tests do).

- [ ] **Step 6: evals workflow**

`.github/workflows/evals.yml`:

```yaml
name: AI Evals
on:
  push: { branches: [master] }
  schedule: [{ cron: "17 8 * * *" }]
  workflow_dispatch:

jobs:
  evals:
    runs-on: ubuntu-latest
    services:
      db:
        image: postgis/postgis:17-3.5
        env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: aptv2_test }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres" --health-interval 5s
          --health-timeout 5s --health-retries 10
    env:
      TEST_DATABASE_URL: postgres://postgres:postgres@localhost:5432/aptv2_test
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @aptv2/evals test
```

(The ANTHROPIC_API_KEY secret is set in Task 7 alongside the others; until then this workflow's live suites skip — by design, not failure.)

- [ ] **Step 7: GREEN + commit + merge + push**

Locally: `pnpm --filter @aptv2/evals test` — filter-satisfaction suite green against local DB; live suites skip without a key (or run if the user's key is in `.env` — state which). `pnpm -r typecheck` green. Commit `feat: AI eval suites - golden parse regression, extraction judge, filter satisfaction`, merge `--no-ff`, push.

---

### Task 5: Neon — provision, migrate, prod-seed

**USER-INTERACTIVE GATE:** requires a Neon project. STOP (NEEDS_CONTEXT) and have the controller ask the user to: create a free project at neon.tech (region: US East, Postgres 17), then create `X:\apartmentscomv2\.env.deploy` (gitignored — verified in Task 1) containing exactly two lines: `NEON_DIRECT_URL=<the direct connection string>` and `NEON_POOLED_URL=<the pooled connection string>` (both shown in Neon's dashboard connection widget; pooled has `-pooler` in the host).

**Files:** none committed (this task provisions and verifies; secrets stay out of git).

- [ ] **Step 1: Gate check**

`.env.deploy` exists with both URLs (`grep -c '^NEON_.*_URL=' .env.deploy` → 2). STOP if absent.

- [ ] **Step 2: Extensions + migrate + prod-seed (DIRECT URL)**

```bash
cd X:/apartmentscomv2
set -a; source .env.deploy; set +a   # NOT `export $(xargs)` — URLs contain ? and &
DATABASE_URL="$NEON_DIRECT_URL" pnpm --filter @aptv2/db migrate
DATABASE_URL="$NEON_DIRECT_URL" pnpm --filter @aptv2/pipeline seed:prod
DATABASE_URL="$NEON_DIRECT_URL" pnpm --filter @aptv2/pipeline seed:prod   # idempotent, same counts
```

Expected: migrations 0001–0006 applied (0001 does `CREATE EXTENSION postgis` — Neon supports it; if the CREATE EXTENSION fails on permissions, run `CREATE EXTENSION postgis;` once via Neon's SQL editor as the user and retry, and record that); `Seeded 8 neighborhoods, 4 sources; seed listings in DB: 0` twice.

- [ ] **Step 3: Read-path verification (POOLED URL)**

Write a throwaway script `packages/db/src/pooled-check.ts` (do NOT commit it — delete after):

```ts
import { getPool, closePool } from './index'
const r = await getPool().query(`SELECT count(*)::int AS n FROM sources WHERE enabled`)
console.log('enabled sources via pooled URL:', r.rows[0].n)
await closePool()
```

```bash
DATABASE_URL="$NEON_POOLED_URL" pnpm --filter @aptv2/db exec tsx src/pooled-check.ts
rm packages/db/src/pooled-check.ts
```

Expected: `enabled sources via pooled URL: 2` — proves the pooled (transaction-mode) path works for the app's query shape.

- [ ] **Step 4: Report**

No commit. Report: migration list applied, seed output (verbatim), pooled-path check output. NO connection strings anywhere in the report.

---

### Task 6: Vercel — project, env, deploy, public URL

**USER-INTERACTIVE GATE #1:** `vercel whoami` must succeed (controller asks user: `npm i -g vercel` then `! vercel login`).
**USER-INTERACTIVE GATE #2:** env vars — the values are secrets, so the USER runs (relayed by controller):
```
! vercel env add DATABASE_URL production        (paste the NEON_POOLED_URL value)
! vercel env add ANTHROPIC_API_KEY production   (paste their Anthropic key)
```
after the project exists (Step 2 below tells the controller when).

**Files:**
- Possibly create: `apps/web/vercel.json` only if a build setting cannot be expressed otherwise (prefer none).

- [ ] **Step 1: Gate #1 check; link project**

```bash
vercel whoami || echo "GATE: STOP"
cd X:/apartmentscomv2 && vercel link --yes   # create new project named apartmentscomv2
vercel git connect                            # bind to the GitHub repo pushed in Task 1
```

- [ ] **Step 2: Root Directory = apps/web**

Try CLI/API first: check whether the installed CLI supports setting it (`vercel project ls`, `vercel inspect`, or `vercel api projects/<id> -X PATCH -d '{"rootDirectory":"apps/web"}'` if the `vercel api` subcommand exists in this CLI version). If no CLI path works, STOP (NEEDS_CONTEXT) and have the controller ask the user to set **Settings → General → Root Directory = `apps/web`** in the Vercel dashboard (one field, include the project URL). Then signal the controller that Gate #2 (env vars) can run. Framework preset: Next.js (auto-detected); install command auto (pnpm from lockfile at repo root — Vercel handles workspaces when Root Directory is inside one).

- [ ] **Step 3: Deploy + verify**

After env vars are in: trigger a production deploy — `git commit --allow-empty -m "chore: trigger initial production deploy" && git push origin plan5-integration` won't deploy master; instead run `vercel deploy --prod` for the first deploy (subsequent deploys ride master pushes via git integration). Then verify the PUBLIC url:

```bash
curl -s https://<production-url>/api/health          # {"ok":true,"db":"up"}
curl -s "https://<production-url>/?q=1+bed" | grep -c "scraped from public property sites"   # >= 1
curl -s "https://<production-url>/?q=1+bed" | grep -ci "seeded demo"                          # 0 (real-only corpus)
```

Also verify the parse badge path: request `/?q=pet+friendly+2br+under+%242400` and confirm the page renders "parsed by Haiku" (key present in prod) — if it shows "keyword fallback", the env var isn't reaching the runtime; diagnose (env scoping, redeploy after env add) before proceeding. NOTE: with zero scraped listings until Task 7's first cloud scrape, searches return 0 with relaxation hints — the corpus counts line reading "0 + 0" is expected at this instant; the health and badge checks are the gate.

- [ ] **Step 4: Report**

Public URL, health output, badge evidence, which Root-Directory path was used. No secrets.

---

### Task 7: Scrape workflow + egress gate + DoD + teardown

**Files:**
- Create: `.github/workflows/scrape.yml`
- Modify: `apps/web/README.md` (Deployment + Teardown sections)

- [ ] **Step 1: Branch; secrets**

```bash
git checkout plan5-integration && git checkout -b task/p5-7-scrape-workflow
set -a; source .env.deploy; set +a
printf '%s' "$NEON_POOLED_URL" | gh secret set DATABASE_URL
# ANTHROPIC_API_KEY: ask the controller to have the user run:  ! gh secret set ANTHROPIC_API_KEY
# (interactive paste; never route the key through agent context)
gh secret list
```

- [ ] **Step 2: scrape.yml**

```yaml
name: Scrape
on:
  schedule: [{ cron: "0 6,14,22 * * *" }]
  workflow_dispatch:

jobs:
  scrape:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @aptv2/worker scrape:all
```

Commit, merge `--no-ff`, push.

- [ ] **Step 3: THE EGRESS GATE — one manual dispatch**

```bash
gh workflow run scrape.yml --ref master   # only if plan5-integration is already merged; otherwise --ref plan5-integration after enabling workflow on that branch via push
gh run watch --exit-status <run-id>
gh run view <run-id> --log | tail -50
```

Read the log VERBATIM into the report. Outcomes:
- **Exit 0:** both sources scraped from the runner — egress confirmed; real listings now in Neon; re-check the public URL shows scraped counts > 0.
- **Exit 2 or 1 with fetch errors:** one/both sites "not publicly reachable from the runner environment" (permitted phrasing, nothing more). STOP and report — the controller decides the fallback (local scheduled scrape → Neon). Do NOT retry more than once.

- [ ] **Step 4: DoD checklist (evidence per item, verbatim pastes)**

1. CI green on latest master push (run URL). Evals workflow: one `workflow_dispatch` run — filter-satisfaction green; live suites ran (key present) with threshold numbers pasted; if any threshold fails, that is a FINDING for the controller (the golden set or prompt needs review), not a reason to lower thresholds.
2. Public URL: health ok; canonical query renders with "parsed by Haiku" badge; corpus line shows `0 seeded + N scraped` with N > 0 (post-egress-gate) OR the recorded egress finding; a scraped listing's detail page loads publicly with the source link; `/admin` shows real lastScraped timestamps from the cloud run; zero-results query (`furnished 1br near Lake Eola under $2,000`) renders relaxation hints.
3. Neon: `seed:prod` idempotency (from Task 5 report), `SELECT count(*) FROM listings WHERE provenance='seed'` → 0.
4. Secrets audit: `git log --all -p -S 'neon.tech' -- . | head` finds nothing; `gh secret list` shows the two names; report contains no secret values.
5. Trailers on all Plan 5 commits; string sweep (`git grep -in "hiring" -- apps packages .github`) → 0.
6. **Teardown section** appended to `apps/web/README.md`: (a) pause scraping: `gh workflow disable scrape.yml` (and `evals.yml` if desired); (b) rotate/revoke the Anthropic key in the Anthropic console; (c) Vercel + Neon idle at $0 — deleting is optional; (d) to resurrect: re-enable workflows, re-add key. Commit with the workflow merge or as a docs commit.

- [ ] **Step 5: Merge readiness**

Merge the task branch `--no-ff` into `plan5-integration`, push. **Do not merge into master** in this task — controller merges after DoD review (standing ruling) — noting that THIS master merge is also the production deploy trigger.
