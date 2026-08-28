import type { RobotsPolicy } from './robots'
import type { PoliteFetcher } from './politeness'

/** One row of the sources registry, as the worker reads it. */
export type SourceRow = {
  id: number
  platform: string
  name: string
  website_url: string
  endpoint_config: {
    /** The availability endpoint this site's own frontend uses — a JSON API route, or the public page embedding the availability JSON. */
    endpoint_url: string
    /** Which of entrata.ts's three payload shapes this source uses (packages/discovery's fingerprinter records this at registration time). Optional: sources seeded before this field existed (SOURCES_SEED) don't carry it — parseEntrataPayload self-detects shape from the payload regardless, so this is informational only, never required for scraping. */
    mode?: 'rest' | 'embedded-v1' | 'embedded-v2'
    /** Property facts recorded at scouting (payloads rarely carry full address/geo). */
    property: {
      name: string
      address_line1: string
      city: string
      state: string
      zip: string
      latitude: number
      longitude: number
    }
  }
  robots_policy: RobotsPolicy | null
  rate_limit_rps: number
}

export type RawSnapshotInput = {
  source_id: number
  content_hash: string
  payload: unknown
}

/** One adapter per platform (spec §3.1): verbatim payloads, no business logic. */
export type Adapter = {
  platform: string
  fetch(source: SourceRow, fetcher: PoliteFetcher): Promise<RawSnapshotInput>
}
