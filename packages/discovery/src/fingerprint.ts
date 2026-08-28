// Pure, offline detection of the three known Entrata payload shapes
// (packages/scrapers/src/entrata.ts): a WordPress plugin ("af3-*" family)
// that exposes availability data either as a standalone JSON REST route, or
// embedded inline in a floor-plans HTML page in one of two formats.

export type FingerprintMode = 'rest' | 'embedded-v1' | 'embedded-v2'

export type FingerprintResult = {
  isEntrata: boolean
  mode: FingerprintMode | null
  /** For 'rest' mode only: the site-relative JSON endpoint path discovered
   * in the page markup (e.g. "/wp-json/entrata/v3/termrent-floor-plans").
   * Embedded modes carry their data in the SAME page that was fingerprinted
   * — there is no separate endpoint to record. */
  endpointPath: string | null
}

// Mirrors entrata.ts's EMBEDDED_JSON_RE / V2_EMBEDDED_ATTR_RE detection
// markers exactly (same regexes as the real extractor uses to locate the
// payload), plus a REST hint: WordPress core (and plugins built on it, like
// the af3-* family) commonly localizes a REST route's URL into an inline
// <script> for frontend JS to consume — the same mechanism as core WP's own
// `wpApiSettings.root`. We look for that literal "/wp-json/entrata/..."
// path fragment (escaped `\/` forms included, since it's typically embedded
// inside a JSON-in-JS string literal).
const EMBEDDED_V1_RE = /<script[^>]*id="jd-fp-data-script-app"[^>]*>/
const EMBEDDED_V2_RE = /:floor_plans='/
const REST_HINT_RE = /((?:\\\/|\/)wp-json(?:\\\/|\/)entrata(?:\\\/|\/)[a-zA-Z0-9\\/_-]*)/i

// Order note: REST is checked FIRST. On the (so far unobserved, and
// vanishingly unlikely) page that carries both a REST hint AND an embedded
// marker, this takes the REST path. That's an acceptable, deliberate choice
// rather than an accident: a dedicated JSON API route is a strictly cleaner,
// more reliable signal to probe than scraping an embedded JS blob out of
// HTML, so when both are present the more trustworthy one should win. No
// real fixture exercises this dual-marker case; reordering (embedded-first)
// would be an equally defensible choice if a real site is ever found to
// need it — this is a documented judgment call, not a load-bearing
// assumption.
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
  return { isEntrata: false, mode: null, endpointPath: null }
}
