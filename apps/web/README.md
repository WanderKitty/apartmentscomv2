# web — apartment search demo (spec §3.1 module 5)

A schema-first pitch, made concrete: extraction depth at ingest (a 93-field
`v1_processed_unit_data` record per listing,
`../../packages/schema/docs/schema.md`), and a
natural-language parse at the front door (`?q=` on `/`). 26 seeded Orlando
listings run end to end through both — no backend required.

## What the demo shows

- **Extraction depth at ingest.** Every listing carries the full
  `v1_processed_unit_data` shape: rent normalized to every frequency,
  concessions amortized into a true monthly cost, `is_X_not_mentioned`
  companions so "absent" is never silently read as "zero", cross-source
  dedup, and a full price-history event log. See
  `../../packages/schema/docs/schema.md` (generated — do not edit by hand)
  and `docs/lineage.md` for where the discipline came from.
- **NL parse at the front door.** Type a query like `pet friendly 2br under
  $2400 near Lake Eola with in-unit laundry` and the parse echo shows
  exactly what was understood — neighborhood, price ceiling, bed count,
  amenities — before any results render, so search never feels like a
  black box.
- **Trust signals, not just a rent number.** Search results and listing
  detail carry freshness stamps, "starting at" flags, net-effective rent
  (advertised rent minus amortized concessions, shown as arithmetic), and
  price-drop history. The demo corpus is seeded, and says so on every
  results page.

## How to run it

```bash
docker compose up -d                      # Postgres + PostGIS (repo root)
pnpm install
pnpm --filter @aptv2/db migrate
pnpm --filter @aptv2/pipeline seed        # 26 seeded Orlando listings → Postgres
pnpm --filter @aptv2/web dev
```

Then open `http://localhost:3000` and search, or open
`http://localhost:3000/?q=pet+friendly+2br+under+%242400+near+Lake+Eola+with+in-unit+laundry`
directly.

Set `ANTHROPIC_API_KEY` to parse queries with Haiku (the parse-source badge
reads "parsed by Haiku · Nms"). Without a key — or if the call times out —
the parser visibly falls back to keyword matching (badge reads "keyword
fallback"); either path returns a complete parse, so the demo never breaks
for lack of a key.

## Routes

- `/` — NL search bar; with `?q=` shows ranked results with trust signals
  (freshness stamp, "starting at" flag, net-effective rent, price drops).
  `&debug=1` exposes per-listing score components (spec §6.3).
- `/listing/[id]` — listing detail with price history, data provenance, and
  a "view at property site" rail. Photos are never rehosted.
- `/admin` — scrape-health ops table (spec §8).

## The seam to the real backend

Pages still talk only to the `SearchService` interface in `lib/types.ts`
(`@aptv2/schema` types) — that seam is now filled. `lib/search.ts` wires it
to `@aptv2/search`'s Postgres implementation: one SQL query over
`properties`/`units`/`listings` that applies filters, PostGIS proximity, and
full-text search, then blends them per spec §6.3. The corpus is loaded by
`@aptv2/pipeline`'s upsert seam (`upsertProcessedUnits`) — the same function
Plan 4's scrape pipeline will call. The in-memory implementation is gone.

## Ingestion

Five pipeline stages (spec §5), each idempotent. Discovery is a manual/CLI
step; scrape and process-snapshot are the two pg-boss job types that carry
the rest:

1. **Discovery.** Sources are seeded as rows via the `seed:sources` CLI command — platform, endpoint URL, and a cached robots.txt policy per source.
2. **Scrape** (`scrape` job). A politeness-gated fetch of the source's endpoint; the payload is hashed and stored verbatim in `raw_snapshots`; an unchanged hash short-circuits the rest of the pipeline but still confirms the source's active listings.
3. **Extract** (`process-snapshot` job). Deterministic adapter mapping first (price/beds/baths/sqft/availability — no LLM), then a fail-open Haiku-class call enriches unstructured fields (concessions, pet policy, etc.) when reachable, degrading to the deterministic result alone when it isn't.
4. **Normalize + dedupe** (`process-snapshot` job, continued). Extracted units are upserted into `properties`/`units`/`listings`; a listing missing from a snapshot that fully succeeded goes active → stale, then stale → gone if it's still missing on the next cycle (one-cycle grace).
5. **Score + index** (`process-snapshot` job, continued). The same trust/freshness/proximity blend and full-text index used by search (see below) apply to scraped listings exactly as they do to seeded ones.

**Politeness posture:** robots.txt honored, including crawl-delay; ≤1 request/sec per domain; an identified User-Agent with a contact; public endpoints only; facts are stored, photos and marketing copy are linked to the source, never rehosted.

**Platform:** Entrata. One adapter handles two payload shapes — a JSON endpoint and JSON embedded in a rendered page — behind the same output contract. Two additional scouted sources are seeded but disabled pending a second embedded-format extractor.

**Running it:**

```bash
pnpm --filter @aptv2/pipeline seed:sources          # seed/refresh source rows
pnpm --filter @aptv2/worker dev                     # worker: heartbeat + scrape/process queues, cron schedules
pnpm --filter @aptv2/worker smoke -- --source <id>  # one-off manual scrape+process for a single source
```

## Schema

`docs/schema.md` (generated — do not edit by hand) now lives at
`../../packages/schema/docs/schema.md`, generated from the schema module in
`@aptv2/schema` via `pnpm --filter @aptv2/schema gen:schema-docs`.

**Schema lineage:** see `docs/lineage.md` for where each field pattern
came from.

### Where the ideas come from

The discipline behind `v1_processed_unit_data` — normalizing every price to
every frequency, treating "absent" and "zero" as different facts, defeating
reposts with a stable identity plus a full event history, two-tier
cross-source dedup — is modeled on a job aggregator. I studied public
payloads from my own browsing session there; the schema implies LLM
extraction at ingest, though I only observed the payload shape, not their
pipeline. A handful of field names are deliberate homages to that source:
`collapse_key`, `liberal_dedup_cluster`, and `original_source_id`. Full
field-by-field lineage is in `docs/lineage.md`.

The schema also reserves management_signals — the landlord-facing analog of
the outcome signals job aggregators compute for employers — populated from
real renter interactions post-demo.

## Commands

```bash
pnpm --filter @aptv2/web dev              # dev server
pnpm --filter @aptv2/web test             # vitest (vitest run)
pnpm --filter @aptv2/web build            # production build
pnpm --filter @aptv2/schema gen:schema-docs  # regenerate packages/schema/docs/schema.md
```
