// Pure, offline detection of the payload shapes the scrapers understand
// (packages/scrapers/src/entrata.ts): the Entrata "af3-*" WordPress family
// as a JSON REST route or one of three embedded HTML formats — rentpress is
// a sibling plugin family syndicating Entrata/Yardi/RealPage feeds into
// common markup — plus Spherexx-built sites.

export type FingerprintMode = 'rest' | 'embedded-v1' | 'embedded-v2' | 'rentpress' | 'spherexx'

export type FingerprintResult = {
  isEntrata: boolean
  mode: FingerprintMode | null
  /** For 'rest' mode only: the site-relative JSON endpoint path found in
   * the page markup. Embedded modes carry their data in the fingerprinted
   * page itself — no separate endpoint to record. */
  endpointPath: string | null
}

// Same markers the real extractors use to locate payloads (entrata.ts).
// RENTPRESS_RE is deliberately looser than the extractor's own regex —
// matching the `rentpress-app` id OR a bare `data-floorplans='` attribute —
// so a differently-id'd rentpress page still fingerprints. The REST hint
// matches the literal "/wp-json/entrata/..." fragment WP localizes into
// inline JS (escaped `\/` forms included).
const EMBEDDED_V1_RE = /<script[^>]*id="jd-fp-data-script-app"[^>]*>/
const EMBEDDED_V2_RE = /:floor_plans='/
const RENTPRESS_RE = /rentpress-app|data-floorplans='/
// Spherexx sites: server-rendered floorplan cards, data-* attributes carry
// pricing (packages/scrapers/src/spherexx.ts). Not an Entrata shape, but
// the same fingerprint-then-verify pipeline serves it.
const SPHEREXX_RE = /floorplans__floorplan[^"]*"[^>]*data-fp=/
const REST_HINT_RE = /((?:\\\/|\/)wp-json(?:\\\/|\/)entrata(?:\\\/|\/)[a-zA-Z0-9\\/_-]*)/i

// Try order mirrors entrata.ts's extractEmbeddedJson. REST is checked
// first deliberately: on a page carrying both a REST hint and an embedded
// marker (never observed), the dedicated JSON route is the cleaner signal.
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
  if (SPHEREXX_RE.test(html)) {
    return { isEntrata: true, mode: 'spherexx', endpointPath: null }
  }
  return { isEntrata: false, mode: null, endpointPath: null }
}
