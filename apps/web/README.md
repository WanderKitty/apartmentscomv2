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
