# web — Next.js UI (spec §3.1 module 5)

The search UI for the apartment aggregator. See
`docs/superpowers/specs/2026-08-27-apartment-aggregator-design.md` for the
full design spec, and the Airbnb design-language reference
(VoltAgent/awesome-design-md → `design-md/airbnb/DESIGN.md`) for the visual
system — tokens live in `app/globals.css`.

## Routes

- `/` — NL search bar; with `?q=` shows ranked results with trust signals
  (freshness stamp, "starting at" flag, net-effective rent, price drops).
  `&debug=1` exposes per-listing score components (spec §6.3).
- `/listing/[id]` — listing detail with price history, data provenance, and
  a "view at property site" rail. Photos are never rehosted.
- `/admin` — scrape-health ops table (spec §8).

## The seam to the real backend

Pages talk only to the `SearchService` interface in `lib/types.ts`.
`lib/mock-search.ts` + `lib/fixtures.ts` are a deterministic stand-in
(keyword parse, invented Orlando data) so the UI runs with no backend.
Replacing `searchService` with the real `search` module implementation is
the whole integration.

## Commands

```bash
npm run dev    # dev server
npm test       # vitest (npx vitest run)
npm run build  # production build
```
