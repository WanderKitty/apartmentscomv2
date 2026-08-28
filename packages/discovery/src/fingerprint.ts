// Pure, offline detection of the four known Entrata payload shapes
// (packages/scrapers/src/entrata.ts): a WordPress plugin ("af3-*" family)
// that exposes availability data either as a standalone JSON REST route, or
// embedded inline in a floor-plans HTML page in one of three formats — the
// third (rentpress) is a distinct component from the same plugin lineage
// used by a separate "RentPress" WordPress plugin family that syndicates
// upstream Entrata/Yardi/RealPage feeds into a common markup shape, which
// is why this fingerprint matters beyond one source (spec: Task 6A).

export type FingerprintMode = 'rest' | 'embedded-v1' | 'embedded-v2' | 'rentpress'

export type FingerprintResult = {
  isEntrata: boolean
  mode: FingerprintMode | null
  /** For 'rest' mode only: the site-relative JSON endpoint path discovered
   * in the page markup (e.g. "/wp-json/entrata/v3/termrent-floor-plans").
   * Embedded modes carry their data in the SAME page that was fingerprinted
   * — there is no separate endpoint to record. */
  endpointPath: string | null
}

// Mirrors entrata.ts's EMBEDDED_JSON_RE / V2_EMBEDDED_ATTR_RE / rentpress
// detection markers exactly (same regexes as the real extractor uses to
// locate the payload — RENTPRESS_RE is deliberately looser than the
// extractor's own RENTPRESS_EMBEDDED_ATTR_RE, matching either the
// `rentpress-app` element id or a bare `data-floorplans='` attribute, so
// fingerprinting still fires even if a future rentpress page renders the
// attribute on a differently-id'd element), plus a REST hint: WordPress
// core (and plugins built on it, like the af3-* family) commonly localizes
// a REST route's URL into an inline <script> for frontend JS to consume —
// the same mechanism as core WP's own `wpApiSettings.root`. We look for
// that literal "/wp-json/entrata/..." path fragment (escaped `\/` forms
// included, since it's typically embedded inside a JSON-in-JS string
// literal).
const EMBEDDED_V1_RE = /<script[^>]*id="jd-fp-data-script-app"[^>]*>/
const EMBEDDED_V2_RE = /:floor_plans='/
const RENTPRESS_RE = /rentpress-app|data-floorplans='/
const REST_HINT_RE = /((?:\\\/|\/)wp-json(?:\\\/|\/)entrata(?:\\\/|\/)[a-zA-Z0-9\\/_-]*)/i

// Order note: REST, then embedded-v1, then embedded-v2, then rentpress
// (mirrors entrata.ts's extractEmbeddedJson try-order exactly). REST is
// checked FIRST. On the (so far unobserved, and vanishingly unlikely) page
// that carries both a REST hint AND an embedded marker, this takes the
// REST path. That's an acceptable, deliberate choice rather than an
// accident: a dedicated JSON API route is a strictly cleaner, more
// reliable signal to probe than scraping an embedded JS blob out of HTML,
// so when both are present the more trustworthy one should win. Among the
// three embedded markers, order is otherwise immaterial in practice — each
// one's marker string is specific to its own shape and none has been
// observed to co-occur with another — but v1/v2/rentpress is kept as the
// canonical order since it matches the extractor's own try sequence. No
// real fixture exercises any dual-marker case; this is a documented
// judgment call, not a load-bearing assumption.
export function fingerprintEntrata(html: string): FingerprintResult {
  const restMatch = html.match(REST_HINT_RE)
  if (restMatch) {
    return { isEntrata: true, mode: 'rest', endpointPath: restMatch[1]!.replace(/\\\//g, '/') }
  }
  if (EMBEDDED_V1_RE.test(html)) {
    return { isEntrata: true, mode: 'embedded-v1', endpointPath: null }
  }
  if (EMBEDDED_V2_RE.test(html)) {
    return { isEntrata: true, mode: 'embedded-v2', endpointPath: null }
  }
  if (RENTPRESS_RE.test(html)) {
    return { isEntrata: true, mode: 'rentpress', endpointPath: null }
  }
  return { isEntrata: false, mode: null, endpointPath: null }
}
