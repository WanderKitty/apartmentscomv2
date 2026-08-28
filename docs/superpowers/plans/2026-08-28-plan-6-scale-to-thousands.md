# Plan 6: Scale to Thousands — FL-Wide Entrata Discovery

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Task 5 is a scaled scouting task with hard compliance STOP-rules; Task 6 runs supervised against production.

**Goal:** Grow the live corpus from 153 to (probably) thousands of real Florida listings: harden the pipeline for scale, add a city filter, unlock the two gated sources via a second embedded-format extractor, and systematically discover + verify Entrata-hosted communities across Florida metros — reporting the honest corpus number early.

**Architecture:** Four hardening moves precede scale (partial-snapshot reprocessing, robots `Allow`/wildcards, per-source rate limits, snapshot/cache economies). The city filter (`ParsedQuery.cities`, closed enum of FL cities) makes multi-metro search work where neighborhood polygons don't exist; the UI shows the city when no neighborhood is assigned (OSM polygons are DESCOPED to post-demo — recorded deviation from the earlier 5-point summary, traded for discovery depth). A new `packages/discovery` turns Task-3-style scouting into a supervised pipeline: an agent-curated candidate list (public directory browsing, human-paced) feeds an automated verifier that fingerprints Entrata, honors robots, probes the known endpoint shapes (REST / embedded-v1 / embedded-v2), extracts property facts (schema.org first, Haiku fallback, Nominatim geocode last resort — with OSM attribution), and registers enabled sources. The scale run executes locally against Neon under supervision, then the Actions cron owns refresh.

**Tech Stack:** Existing monorepo. No new services; Nominatim (OSM) used only as a geocoding fallback at ≤1 req/s with attribution. Extraction cost note: first full run ≈ thousands of Haiku calls ≈ low single-digit dollars.

**Spec:** `docs/superpowers/specs/2026-08-27-apartment-aggregator-design.md` §5.1 (discovery), §7 (compliance — unchanged and binding at scale). Standing rulings: FL-wide Entrata route; thousands probable-not-promised with early count reporting; exact-bed semantics; real-only prod corpus.

## Global Constraints

- Branching as before: `plan6-integration` off `master`, task branches `task/p6-<n>-<slug>`, `--no-ff` merges, master merge at the end if green (NOTE: master pushes auto-deploy production — every master merge is a deploy).
- **Compliance at scale (binding):** every automated candidate request goes through the politeness fetcher (robots checked BEFORE any probe; ≤1 req/s per domain; UA unchanged). Per candidate, at most 4 requests (robots, homepage, one endpoint probe, one contact/about page). A candidate showing login/ToS/challenge is skipped and recorded as "not publicly accessible" — no other characterization, anywhere, ever. Nominatim: ≤1 req/s, descriptive UA, results cached in the DB, used only when the site's own markup lacks address/geo; the app footer and README gain "Geocoding © OpenStreetMap contributors" when (and only when) Nominatim-derived coordinates are actually stored.
- **Discovery runs are SUPERVISED and local** — never scheduled, never in Actions. The scheduled cron only refreshes already-registered sources.
- Secrets discipline, TDD, `noUncheckedIndexedAccess` `!` reporting, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` — all as in Plans 4–5. Verbatim output in live-run reports.
- Neon free-tier watch: after the scale run, report `pg_database_size` — if raw_snapshots trends past ~350MB, the Task-1 storage economy must be confirmed working before adding more sources.
- Windows locally; bash via the Bash tool.

---

### Task 1: Pipeline hardening for scale

**Files:**
- Create: `packages/db/migrations/0007_partial_processing.sql`
- Modify: `apps/worker/src/jobs/scrape.ts`, `packages/scrapers/src/robots.ts` (+tests), `packages/scrapers/src/politeness.ts` (+tests), `packages/pipeline/src/extract.ts`, `packages/pipeline/src/sources-seed.ts`
- Test: extend `packages/db/test/schema-ingestion.test.ts`, `apps/worker/test/scrape.test.ts`, `packages/scrapers/src/robots.test.ts`, `packages/scrapers/src/politeness.test.ts`, `packages/pipeline/test/upsert.test.ts` or `extract.test.ts`

**Interfaces:** Produces (Tasks 5–6 depend on): `raw_snapshots.processing_status` gains `'partial'`; the unchanged-hash short-circuit only fires when the matched prior snapshot is fully `'processed'` (prod incident 2026-08-28: a partial failure followed by unchanged content was never reprocessed); `parseRobots`/`isPathAllowed` support `Allow`, `*`, `$` with longest-match-wins (Google REP semantics; Allow wins length ties); `fetchJson`/`fetchText` accept an optional `maxRps` per call and `runScrape` passes `source.rate_limit_rps`; unchanged snapshots store `{"unchanged_ref": <prior id>}` instead of duplicating the payload (storage economy — audit row kept, replay unaffected since only non-skipped rows are replayed); `extractSnapshot` batch-fetches `extract_cache` rows in one `ANY($1)` query; `seedSources` no longer overwrites `enabled` on conflict (ops decisions survive reseeding).

- [ ] **Step 1:** Branches; failing tests FIRST for each behavior above, one behavior at a time (RED evidence per behavior):
  - 0007 migration test: inserting `processing_status = 'partial'` accepted; `'bogus'` rejected.
  - Worker test: cycle 1 processes with 1 corrupted unit (partial) → cycle 2 SAME payload → must NOT short-circuit (snapshot pending, processing rerun); after a fully-clean process, cycle 3 same payload → short-circuits.
  - Robots tests: `Allow: /wp-json/` under a broader `Disallow: /wp-`; wildcard `Disallow: /*?s=`; `$` anchor; longest-match + Allow-tie rules (encode the Google REP examples you assert).
  - Politeness test: per-call `maxRps: 0.5` produces ≥1999ms spacing.
  - Sources-seed test: manual `UPDATE sources SET enabled = false` survives a reseed.
  - Extract test: cache batch path returns identical results (behavioral, not query-count).
- [ ] **Step 2:** Implement each; migration 0007 is exactly:

```sql
-- Partial processing visibility (prod incident 2026-08-28): a snapshot whose
-- unit extraction partially failed must be distinguishable from a fully
-- processed one, so the unchanged-hash short-circuit can decline to skip.
ALTER TABLE raw_snapshots DROP CONSTRAINT raw_snapshots_processing_status_check;
ALTER TABLE raw_snapshots ADD CONSTRAINT raw_snapshots_processing_status_check
  CHECK (processing_status IN ('pending', 'processed', 'partial', 'failed', 'skipped_unchanged'));
```

  `runProcess` sets `'partial'` when `failures.length > 0`; the dup-check in `runScrape` becomes `... AND processing_status = 'processed'`; the unchanged INSERT stores `{"unchanged_ref": <matched id>}` as payload.
- [ ] **Step 3:** Full repo green; commit/merge/push per convention.

---

### Task 2: City filter

**Files:**
- Modify: `packages/schema/src/types.ts` (`ParsedQuery.cities: string[]`), `packages/schema/src/taxonomy.ts` (add `FLORIDA_CITIES`), `packages/search/src/keyword-parse.ts`, `packages/search/src/llm-parse.ts` (enum + prompt + mapping), `packages/search/src/postgres-search.ts` (SQL `$9`, chips-adjacent helpers: activeDrops + rebuildQuery), `apps/web/components/ParseEcho.tsx` (city chip), `packages/evals/src/goldens.ts` (+5 city goldens; extend eval fields)
- Test: `packages/search/test/postgres-search.test.ts`, evals updates

**Interfaces:** `FLORIDA_CITIES = ['Orlando','Tampa','Miami','Jacksonville','St. Petersburg','Fort Lauderdale','Kissimmee','Winter Park','Gainesville','Tallahassee'] as const` (closed enum; discovery may only register sources in these cities or add to this list in the same commit). SQL: `AND (cardinality($9::text[]) = 0 OR lower(p.city) = ANY($9))` with lowercased params. Chip renders the city name; relaxation drop `city`; `rebuildQuery` emits `in <city>` when no neighborhood.

- [ ] **Step 1:** Failing tests: keyword parse `'2br in tampa'` → `cities: ['Tampa']`, no neighborhood; `'downtown orlando'` still the NEIGHBORHOOD (alias precedence: neighborhood aliases match first; a bare city name that also prefixes an alias must not double-count); SQL test: seed a Tampa property+listing, assert city filter includes/excludes correctly and combines with beds.
- [ ] **Step 2:** Implement; LLM prompt gains the cities enum with the rule "a city name is a city filter; neighborhood names take precedence when both could match".
- [ ] **Step 3:** Goldens: append exactly 5 (Tampa/Miami/Jax phrasings with beds/price mixes, expectations incl. `cities`); extend the eval's `fields` array with `cities` at threshold ≥0.9. Full repo green; commit/merge/push.

---

### Task 3: Second embedded-format extractor (re-enable Aperture + Knightsbridge)

**Files:**
- Create: `packages/scrapers/fixtures/entrata-embedded-v2.html` (ONE sanctioned capture), README provenance entry
- Modify: `packages/scrapers/src/entrata.ts` (+tests), `packages/pipeline/src/sources-seed.ts` (re-enable the two sources), seed test

**Interfaces:** The embedded extraction tries, in order: (1) the `jd-fp-data-script-app` script pattern (existing), (2) the entity-encoded `af3_entrata_options`-adjacent array documented in the Plan-4 Task-3 report — decode HTML entities, locate/parse the JSON array, normalize to the same payload shape `parseEntrataPayload` consumes. The stale coverage comment is replaced with the true coverage statement.

- [ ] **Step 1:** ONE sanctioned capture: a single human-paced request to Aperture's floor-plans page (robots re-verified first — its robots.txt was recorded in the Plan-4 Task-3 report; re-fetch once to confirm unchanged), saved verbatim as the fixture with provenance. STOP-rules apply: not publicly readable → report and keep both sources disabled (the task then ships extractor-against-report-documented-structure only if a fixture exists; NO fixture → task descopes to comment corrections, honestly reported).
- [ ] **Step 2:** Failing golden tests against the real v2 fixture (unit count observed, one known external id, both extraction paths); implement; the extract-stage embedded test gains a v2 case.
- [ ] **Step 3:** Re-enable the two sources in `SOURCES_SEED` (seed test updated); full repo green; commit/merge/push. Post-merge (this branch, supervised): run `seed:sources` against Neon (`.env.deploy` direct URL) and ONE local `scrape-all` against Neon to land the two sources' units; record counts verbatim.

---

### Task 4: City display fallback (polygons descoped)

**Files:** `apps/web/components/ListingCard.tsx`, `apps/web/app/listing/[id]/page.tsx` if it renders neighborhood, tests.

**Interfaces:** When `listing.neighborhood` is empty, the card and detail page show `listing.address`'s city (the `Listing` already carries the full address; add a tiny `cityOf(listing)` or thread `city` through the mapper if cleaner — implementer's choice, stated). No blank separators anywhere. **Recorded descope:** real OSM neighborhood polygons are deferred post-demo (effort disproportionate for the window; the city filter is the geographic workhorse). One test per surface.

---

### Task 5: `packages/discovery` — scaled, supervised source discovery

The Task-3 scouting flow, systematized. An AGENT curates candidates by browsing public directories (WebSearch/WebFetch, human-paced — management-company portfolio pages, metro apartment directories); a PROGRAM verifies them politely and registers sources.

**Files:**
- Create: `packages/discovery/package.json` (+tsconfig/vitest/setup per house pattern), `src/fingerprint.ts`, `src/facts.ts`, `src/verify.ts`, `src/discover-cli.ts`, `src/index.ts`, `candidates/fl-metros.json` (agent-curated, checked in), tests from captured mini-fixtures
- Modify: `packages/pipeline/src/sources-seed.ts` only if a shared upsert helper is extracted (discovery registers sources directly)

**Interfaces:**
- `candidates/fl-metros.json`: `Array<{ url: string; metro: string; note?: string }>` — target 150–250 candidates across the FLORIDA_CITIES metros, provenance-noted (which public directory/portfolio page it came from).
- `fingerprintEntrata(html): { isEntrata: boolean; mode: 'rest' | 'embedded-v1' | 'embedded-v2' | null; endpointPath: string | null }` — pure, tested on trimmed fixture snippets from the three known shapes.
- `extractPropertyFacts(html, url, deps): Promise<{ name, address_line1, city, state, zip, latitude, longitude } | null>` — deterministic first (schema.org/LD+JSON `PostalAddress` + `geo`), Haiku fallback on visible contact text (fail-open), Nominatim geocode ONLY when coordinates are still missing (cached in a `geocode_cache` table created here via migration 0008; attribution wiring per Global Constraints). City must be in `FLORIDA_CITIES` else the candidate is recorded `out_of_scope`.
- `verifyCandidate(candidate, fetcher, deps): Promise<VerifyResult>` — robots first (STOP on disallow), ≤4 requests, returns a verdict record `{ url, verdict: 'registered' | 'not_entrata' | 'not_public' | 'no_endpoint' | 'no_facts' | 'out_of_scope', detail }`; on success upserts the `sources` row (enabled) with correct `endpoint_config` incl. mode.
- `discover-cli`: reads the candidates file, runs verification SEQUENTIALLY with progress lines, writes `discovery-report-<date>.json` (gitignored) + prints the tally. Idempotent by `website_url`.

- [ ] **Step 1:** Scaffold + failing tests for `fingerprintEntrata` and the deterministic facts path (fixture snippets captured from the ALREADY-HELD fixtures + Task-3 report excerpts — no new network for tests).
- [ ] **Step 2:** Implement fingerprint/facts/verify with full TDD; `verifyCandidate`'s network path is dependency-injected and tested with fake fetchers covering every verdict.
- [ ] **Step 3 (AGENT, human-paced):** Curate `candidates/fl-metros.json` — browse public metro directories and Entrata/management portfolio pages; record provenance per entry; STOP-rules as always. Target ≥150 candidates; fewer is a reported finding, not a failure.
- [ ] **Step 4:** Migration 0008 (`geocode_cache(query text PRIMARY KEY, latitude float8, longitude float8, created_at)`) + attribution footer/README wiring (conditional on Nominatim use).
- [ ] **Step 5:** Full repo green; commit/merge/push. The CLI is NOT run in this task.

---

### Task 6: Supervised scale run + DoD

- [ ] **Step 1 (supervised, local, against Neon direct URL):** `pnpm --filter @aptv2/discovery exec tsx src/discover-cli.ts candidates/fl-metros.json` — watch the tally live; paste the verdict distribution verbatim. **Report the registered-source count and projected unit range to the user IMMEDIATELY** (standing ruling: honest numbers early) before proceeding.
- [ ] **Step 2:** Raise `scrape.yml` `timeout-minutes` proportionally (≈ 15 + N/10); run ONE local `scrape-all` against Neon (first-contact run, supervised; per-source failures are findings with permitted phrasing only). Paste per-source summary. Then dispatch the Actions scrape once to confirm the runner handles the full set within timeout.
- [ ] **Step 3: DoD:** public site checks at scale (corpus line count; a Tampa city-filter query returns Tampa listings with the city chip; exact-bed query; relaxation hints; a scraped detail page per new metro); evals green post-merge (city goldens live); `SELECT pg_database_size(current_database())` + `raw_snapshots` row/size stats vs the free-tier watch; admin page renders all sources; string sweep; trailers; teardown README still accurate (update source count).
- [ ] **Step 4:** Merge readiness — stop before master; controller merges after DoD review (master merge = production deploy of the city filter et al.; the corpus is already live via Neon regardless).
