# Fixtures provenance

## entrata-availability.json

- **Source:** Current Orlando — 4750 Data Ct, Orlando, FL 32817 (`https://www.currentorlando.com`)
- **Endpoint:** `https://www.currentorlando.com/wp-json/entrata/v3/termrent-floor-plans`
- **Capture timestamp:** 2026-08-27T23:26:12Z (server `date` response header from the capture request; see below)
- **Method:** Single `curl` GET request with a normal browser User-Agent and `Accept: application/json` header, no query parameters, no retries. Response saved byte-for-byte as returned (`content-type: application/json; charset=UTF-8`, HTTP 200).
- **Platform note:** RentCafe-hosted sites were not publicly reachable from this environment, so scouting targeted Entrata-backed communities instead (spec §5.1's "Entrata/ProspectPortal" fingerprint — this property's lease/apply flow is on `prospectportal.com`, and its own site independently exposes this floorplans/availability JSON route). AppFolio was also checked and its JSON listings API required authentication everywhere it was tried; see the task report for full detail.

Captured once from a public endpoint during scouting; used only as a test fixture (spec §8: no network in tests). No photos or other binary assets were captured — the JSON payload does include ordinary photo URL references from the source page (facts/links only, consistent with spec §7 "link photos, never rehost").

## entrata-embedded.html

- **Source:** Society Orlando — 410 N Orange Ave, Orlando, FL 32801 (`https://societyorlando.com`)
- **Endpoint:** `https://societyorlando.com/floorplans/`
- **Capture timestamp:** 2026-08-27T23:46:39Z (server `date` response header from the capture request)
- **Method:** Single `curl` GET request with a normal browser User-Agent, no query parameters, no retries. Response saved byte-for-byte as returned (`content-type: text/html; charset=UTF-8`, HTTP 200). This is Task 4's one sanctioned additional capture, needed to test the embedded-JSON fetch path (3 of the 4 seeded Entrata sources embed their availability JSON inside this floor-plans HTML page rather than exposing a standalone JSON endpoint; see the Task 3 report).
- **Saved verbatim to:** `packages/scrapers/fixtures/entrata-embedded.html`

The page embeds its availability data as a `<script type="application/json" id="jd-fp-data-script-app">` element; the JSON inside is a widget-config object carrying `units` (137 per-unit records: apartment number, beds/baths/sqft, price, available date, and a `specials`/`amenities` free-text list) and `floorplans` (21 floorplan-level aggregates) — structurally different from `entrata-availability.json`'s lease-term/floorplan-group shape, not just a different transport. No photos or other binary assets were extracted from this capture for use elsewhere; the saved HTML is used only as a test fixture (spec §8: no network in tests).
