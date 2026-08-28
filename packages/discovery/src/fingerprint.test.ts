import { describe, it, expect } from 'vitest'
import { fingerprintEntrata } from './fingerprint'

// Snippets below are trimmed excerpts of the exact markers documented in
// packages/scrapers/src/entrata.ts and packages/scrapers/fixtures/README.md
// for the three known Entrata payload shapes:
//   - REST: Current Orlando's `/wp-json/entrata/v3/termrent-floor-plans`
//     (entrata-availability.json's provenance). No homepage capture of
//     Current Orlando exists in the repo (only the endpoint's own JSON
//     response was captured), so this snippet is CONSTRUCTED — not lifted
//     verbatim from a committed fixture — modeling the well-known WordPress
//     pattern of localizing a plugin's REST route into an inline script for
//     frontend JS to consume (the same mechanism core WP uses for
//     `wpApiSettings`). Documented as an assumption in the task report.
//   - embedded-v1: the `jd-fp-data-script-app` script tag, trimmed from
//     packages/scrapers/fixtures/entrata-embedded.html (Society Orlando).
//   - embedded-v2: the `:floor_plans='...'` Vue attribute, trimmed from
//     packages/scrapers/fixtures/entrata-embedded-v2.html (Aperture).

const REST_HINT_SNIPPET = `
<script id="af3-entrata-js-extra">
var af3EntrataSettings = {"root":"https:\\/\\/www.currentorlando.com\\/wp-json\\/","endpoint":"\\/wp-json\\/entrata\\/v3\\/termrent-floor-plans"};
</script>
`

const EMBEDDED_V1_SNIPPET = `
<div id="jd-fp-app"></div>
<script type="application/json" id="jd-fp-data-script-app">{"version":"1.12.0","base_uri":"\\/floorplans\\/","units":[{"id_value":123,"bedrooms":"1","bathrooms":"1"}]}</script>
`

const EMBEDDED_V2_SNIPPET = `
<div id="app">
<floor-plan-page-main-component inline-template :floor_plans='[{"post_id":2684,"title":"1BR\\/1BA","bedrooms":"1","bathrooms":"1"}]' base-url="https://apertureorlando.com"></floor-plan-page-main-component>
</div>
`

const PLAIN_HTML = `<!doctype html><html><head><title>Some Apartments</title></head><body><h1>Welcome</h1><p>Call us to lease today.</p></body></html>`

describe('fingerprintEntrata', () => {
  it('detects the REST wp-json/entrata endpoint hint', () => {
    const result = fingerprintEntrata(REST_HINT_SNIPPET)
    expect(result.isEntrata).toBe(true)
    expect(result.mode).toBe('rest')
    expect(result.endpointPath).toBe('/wp-json/entrata/v3/termrent-floor-plans')
  })

  it('detects the embedded-v1 jd-fp-data-script-app marker', () => {
    const result = fingerprintEntrata(EMBEDDED_V1_SNIPPET)
    expect(result.isEntrata).toBe(true)
    expect(result.mode).toBe('embedded-v1')
    expect(result.endpointPath).toBeNull()
  })

  it('detects the embedded-v2 :floor_plans= attribute marker', () => {
    const result = fingerprintEntrata(EMBEDDED_V2_SNIPPET)
    expect(result.isEntrata).toBe(true)
    expect(result.mode).toBe('embedded-v2')
    expect(result.endpointPath).toBeNull()
  })

  it('returns isEntrata false with no mode for non-Entrata HTML', () => {
    const result = fingerprintEntrata(PLAIN_HTML)
    expect(result.isEntrata).toBe(false)
    expect(result.mode).toBeNull()
    expect(result.endpointPath).toBeNull()
  })
})
