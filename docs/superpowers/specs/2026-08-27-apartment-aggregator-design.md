# Apartment Listing Aggregator — Design Spec

**Date:** 2026-08-27
**Status:** Approved design, pre-implementation
**Working name:** apartmentscomv2

## 1. Product summary

A hiring.cafe-style search engine for apartments. We scrape apartment communities' own websites (the primary source), structure the data with LLMs at ingest, score every listing for trust and freshness, and serve a natural-language search bar ("furnished short term near downtown orlando under $2k") that returns ranked, trustworthy listings.

**Differentiation:** primary-source data (no aggregator arbitrage), visible trust signals (freshness timestamps, price history, "starting at" flagged honestly, net-effective rent with concessions), and NL search that actually understands the query.

## 2. Decisions locked in

| Decision | Choice |
|---|---|
| Purpose | Real product with users (zero users today — optimize for shipping speed with scale-ready seams) |
| Geographic scope | Single metro at launch: Orlando. Expand only after the model proves out |
| Data sourcing | Scrape property-management community sites directly (RentCafe, AppFolio, Entrata, ...), never aggregators. Facts only — photos and marketing copy are linked, never rehosted |
| Query understanding | Single constrained structured-output call to a small fast LLM (Haiku-class) → filter JSON. Not an agent, not a trained NER model. Cached, fail-open |
| Ranking | Query relevance blended with query-independent trust/completeness + freshness scores. Hand-tuned linear blend at v1; learned ranker only after click data exists |
| Architecture | TypeScript modular monolith. One repo, Postgres as sole datastore, two deployed processes (web + worker) |
| Dev workflow | Subagent-driven development: each implementation task on its own branch, reviewed by Fable before merge. TDD throughout |

## 3. Architecture overview

One TypeScript monorepo, deployed as two processes sharing one Postgres database (with PostGIS). pg-boss (Postgres-backed job queue) drives all background work — no Redis, no broker.

```
┌─────────────────────────── Postgres (+ PostGIS) ───────────────────────────┐
│  raw_snapshots │ properties │ units │ listings │ neighborhoods │ job queue │
└────────▲───────────────▲──────────────────────────────▲───────────────────┘
         │               │                              │
   ┌─────┴─────────┐  ┌──┴──────────────┐   ┌───────────┴───────────┐
   │  WORKER proc  │  │ (same worker)   │   │       WEB proc        │
   │  Ingestion    │  │ Processing      │   │  Next.js app + API    │
   │  - discovery  │  │ - extract (LLM) │   │  - query parse (LLM)  │
   │  - fingerprint│  │ - normalize     │   │  - search + rank      │
   │  - scrapers   │  │ - dedupe        │   │  - listing pages      │
   │  (per-platform│  │ - score         │   └───────────────────────┘
   │   adapters)   │  │ - index         │
   └───────────────┘  └─────────────────┘
```

### 3.1 Modules (hard interface boundaries; folders today, service seams tomorrow)

1. **`discovery`** — finds communities in a metro, fingerprints each site's platform, maintains the `sources` registry with robots.txt policy and rate limits.
2. **`scrapers`** — one adapter per *platform* (not per property), all implementing `fetch(source) → RawSnapshot[]`. Adapters hit the JSON endpoints the sites' own frontends use and write verbatim payloads. No business logic.
3. **`pipeline`** — pure, replayable functions from stored snapshot to serving-ready rows: deterministic field mapping, LLM extraction of unstructured text, normalization, dedup, geo/neighborhood tagging, trust+freshness scoring.
4. **`search`** — everything behind a single `SearchService` interface: query parse, SQL retrieval (filters + PostGIS + FTS), ranking blend. The one interface to reimplement if Postgres search is ever outgrown.
5. **`web`** — Next.js UI and API routes. Reads indexed listing tables only through `search`; knows nothing about ingestion.

### 3.2 Scalability posture

Load profile is read-heavy search (scales with caching/read replicas) plus scheduled batch ingestion (embarrassingly parallel worker processes). Reference point: hiring.cafe serves 1.3M MAU on architecturally a monolith with an index in front, run by two people for under $1k/mo at 1.5M items scraped daily. Named escape hatches, in order, each behind an existing seam:

- Queue: pg-boss → BullMQ + Redis
- Search: Postgres FTS → pg_search (BM25) → Typesense → Elasticsearch
- Retrieval: add pgvector semantic leg fused via RRF (embedding column is schema-reserved, unpopulated)
- Ranking: linear blend → LambdaMART once `search_logs` has months of click data
- Query parse: cached LLM calls → fine-tuned tiny model trained on logged `query → filters` pairs

## 4. Data model

Three-level hierarchy (aggregators flatten this; the flattening is why their data is bad):

- **`properties`** — the physical community. Identity: normalized address + geocoded point. Name, address, `location geography(Point)`, `neighborhood_id`, platform, website URL, community amenities, photo URLs (linked, never rehosted), management company, first/last seen.
- **`units`** — floorplans and (where exposed) actual units. One table, `kind` column (`floorplan` | `unit`), self-referencing `floorplan_id`. Beds, baths, sqft, unit amenities.
- **`listings`** — the availability event; the table search runs against, denormalized with score, neighborhood, location, tsvector. Price, `price_is_starting_at` flag, concessions text + parsed net-effective rent, available date, lease terms, `status` (active/stale/gone), `first_listed_at`, `last_confirmed_at`, price-change history (count + JSONB array).

Supporting tables:

- **`sources`** — one row per scrape target: platform, endpoints, robots policy, rate limit, `last_scraped_at`, failure streak, enabled flag.
- **`raw_snapshots`** — append-only verbatim payloads (JSONB) with content hash and processing status. The replayable pipeline input and audit trail. Compress/archive old rows.
- **`neighborhoods`** — name, aliases array, `boundary geography(Polygon)`. Loaded from Orlando open data / OSM. Aliases feed the query-parser enum.
- **`search_logs`** — raw query, parsed filter JSON, result count, clicked listing ids. Future ranker training data.
- **`scrape_runs`** — per-execution timing, counts, errors. Powers ops dashboard and alerts.
- **`query_parses`** — parse cache keyed on normalized query text.
- **`review_queue`** — ambiguous dedup matches awaiting human confirmation.

Key rules:

1. **Listings are events, not mutations.** Price changes append to history; nothing is hard-deleted. `status='gone'` rows become the historical pricing dataset.
2. **`last_confirmed_at` drives freshness** — bumped by every scrape that still sees the listing; drives both ranking decay and the gone transition.
3. **Postgres-native:** tsvector maintained by trigger, PostGIS for geo, JSONB for not-yet-promoted platform fields, pgvector column reserved but empty.

## 5. Ingestion pipeline

Five stages; each a pg-boss job type; each idempotent.

1. **Discovery** (metro launch, then weekly). Seeds: city/county open data + property-appraiser multifamily parcels; management-company portfolio pages; Google Places as URL gap-filler only (ToS forbids storing Places content). Fingerprint platform from markup signatures (`api.rentcafe.com`, `*.securecafe.com`, `*.appfolio.com/listings`, Entrata/ProspectPortal markers, SightMap embeds). Check robots.txt. Unsupported platforms recorded as `platform='unknown'` — the adapter backlog, prioritized by count.
2. **Scrape** (cron, 2–4×/day per source, staggered). Politeness enforced centrally: per-domain token bucket (≤1 req/sec, slower if robots.txt says), descriptive User-Agent with contact URL, exponential backoff. Verbatim payloads → `raw_snapshots` with content hash. **Hash-match short-circuit:** unchanged snapshot ends the pipeline but still bumps `last_confirmed_at` on the source's active listings.
3. **Extract** (per changed snapshot). Deterministic adapter mapping first (price/beds/baths/sqft/availability — no LLM). Then one Haiku-class structured-output call per changed property for genuinely unstructured content: concessions → net-effective rent, pet policy, furnished/short-term terms, income restrictions, summary. Outputs enum-validated against our taxonomy; out-of-enum values dropped, not stored. Results cached by content hash.
4. **Normalize + dedupe.** Upsert properties/units/listings. Identity resolution: exact normalized address, then geocode proximity (<50m) + fuzzy name. Gray-zone matches → `review_queue` (human-checkable; a few rows/week at metro scale). Vanished listings → `status='gone'` after a one-cycle grace period.
5. **Score + index.** Trust/completeness score (unit-level pricing vs "starting at", photos, description, fee disclosure, source success streak) and freshness (exponential decay on `last_confirmed_at`, half-life ~3 days). Refresh tsvector. Nightly sweep re-decays all freshness and emits staleness alerts (any source failing 48h).

**Error handling:** fail loudly and partially. One property's malformed JSON fails that property's job only; pg-boss retries with backoff; N failures flag the source. No silent catch-and-continue — every skip is a counted, visible event. Bugs in extract/normalize are fixed by replaying `raw_snapshots`, never by re-scraping.

## 6. Search & ranking (query path)

Budget: ~500ms warm, ~1.2s cold.

1. **Parse.** Normalize query text; check `query_parses` cache. On miss, one structured-output call to a Haiku-class model with a closed schema — `neighborhood_ids` (enum from neighborhood aliases), `price_max`, `beds_min`, `furnished`, `lease_term`, `amenities` (enum from taxonomy), `residual_text`. The prompt embeds valid enums; validation rejects anything outside them. **Fail-open ladder:** parse error or >800ms timeout → raw text as FTS + metro-wide geo. The search bar never errors on a model hiccup. Every parse logged to `search_logs`.
2. **Retrieve.** One SQL query on `listings`: hard WHERE clauses (price, beds, furnished, lease term, status='active'), `ST_Within` on the neighborhood polygon, tsquery only when `residual_text` is non-empty. Hard filters are never soft. Exception to silent filtering: listings with *undisclosed* price are not dropped by a price filter — they rank last with a "price not listed" badge.
3. **Rank.** Linear blend in SQL: `score = 0.35·text_relevance + 0.30·freshness + 0.25·trust + 0.10·proximity`. Weights in config. Debug view (`?debug=1`) exposes per-listing score components.
4. **Serve.** Trust signals rendered visibly: "confirmed 6h ago", price-drop history, "starting at" flagged, net-effective rent when concessions exist.

## 7. Compliance guardrails (design-level)

- Scrape only publicly accessible pages/endpoints; never behind a login; never accept ToS to reach data (hiQ v. LinkedIn / Meta v. Bright Data posture).
- Store facts (rents, availability, unit specs); link photos and descriptions to source, never rehost or republish marketing copy verbatim (Feist; VHT v. Zillow).
- Honor robots.txt including crawl-delay; identify the bot with a contact URL; ≤1 req/sec per domain.
- Google Places output used only as a discovery seed for URLs to verify, not stored as content.

## 8. Ops & testing

**Deployment:** Railway or Fly, two processes + managed Postgres (~$25–40/mo). Nightly `pg_dump` to object storage.

**Observability:** `/admin` page over `scrape_runs`/`sources`: scrape health, failure streaks, listing counts, staleness. Email alerts: source failing 48h; listing count drops >20%/day (adapter breakage signal); LLM error-rate spike.

**Testing strategy:**
- Adapters: fixture JSON captured from real sites; no network in tests.
- Pipeline: pure functions; golden-file tests snapshot → expected rows.
- Query parser: regression suite of ~50 real queries → expected filter JSON (mocked in CI; run live weekly).
- Ranking: fixed query set; top-10 reviewed on weight changes.
- TDD throughout implementation (superpowers workflow).

## 9. V1 cut-line

**In:** Orlando; two platform adapters (RentCafe, AppFolio); NL search bar; ranked list UI with trust signals; listing detail pages linking out to source; admin/ops page.

**Out (each a clean post-launch addition):** more metros; more adapters (Entrata next, by `platform='unknown'` counts); user accounts; saved searches/alerts; map UI; embeddings/semantic leg; reranker/LTR; mobile app; monetization (hiring.cafe lesson: never charge renters; future revenue is property-side promotion).

## 10. Implementation workflow

Subagent-driven development per the superpowers workflow: the implementation plan (written next via the writing-plans skill) decomposes into independent tasks; each task is executed by a subagent on its own git branch/worktree; Fable reviews each branch before merge. TDD is the default for every task.
