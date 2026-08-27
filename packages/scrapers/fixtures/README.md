# Fixtures provenance

## entrata-availability.json

- **Source:** Current Orlando — 4750 Data Ct, Orlando, FL 32817 (`https://www.currentorlando.com`)
- **Endpoint:** `https://www.currentorlando.com/wp-json/entrata/v3/termrent-floor-plans`
- **Capture timestamp:** 2026-08-27T23:26:12Z (server `date` response header from the capture request; see below)
- **Method:** Single `curl` GET request with a normal browser User-Agent and `Accept: application/json` header, no query parameters, no retries. Response saved byte-for-byte as returned (`content-type: application/json; charset=UTF-8`, HTTP 200).
- **Platform note:** RentCafe-hosted sites were not publicly reachable from this environment, so scouting targeted Entrata-backed communities instead (spec §5.1's "Entrata/ProspectPortal" fingerprint — this property's lease/apply flow is on `prospectportal.com`, and its own site independently exposes this floorplans/availability JSON route). AppFolio was also checked and its JSON listings API required authentication everywhere it was tried; see the task report for full detail.

Captured once from a public endpoint during scouting; used only as a test fixture (spec §8: no network in tests). No photos or other binary assets were captured — the JSON payload does include ordinary photo URL references from the source page (facts/links only, consistent with spec §7 "link photos, never rehost").
