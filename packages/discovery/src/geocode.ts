import type pg from 'pg'
import type { GeocodeFn } from './facts'

// Nominatim (OpenStreetMap) geocode fallback, used ONLY when a candidate's
// own site markup has no coordinates (facts.ts). Compliance: ≤1 req/s, a
// descriptive UA, and every result — including a genuine MISS, stored as a
// NULL-coordinate row — cached in `geocode_cache` so the same query is
// never re-geocoded. Attribution ("Geocoding data © OpenStreetMap
// contributors") is wired in apps/web's footer and README.

const NOMINATIM_USER_AGENT = 'aptv2-research-bot/0.1 (+mailto:volodolzh@gmail.com)'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'

export function createNominatimGeocoder(
  pool: pg.Pool,
  opts: {
    fetchImpl?: typeof fetch
    now?: () => number
    sleep?: (ms: number) => Promise<void>
  } = {},
): GeocodeFn {
  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const minGapMs = 1000 // ≤1 req/s, single host
  let lastRequestAt: number | undefined

  const cacheMiss = async (query: string): Promise<null> => {
    await pool.query(
      `INSERT INTO geocode_cache (query, latitude, longitude) VALUES ($1, NULL, NULL)
       ON CONFLICT (query) DO NOTHING`,
      [query],
    )
    return null
  }

  return async function geocode(query: string): Promise<{ latitude: number; longitude: number } | null> {
    const { rows: cached } = await pool.query(`SELECT latitude, longitude FROM geocode_cache WHERE query = $1`, [
      query,
    ])
    if (cached.length > 0) {
      const row = cached[0]
      // A cached MISS (a prior genuine "no result") is still a cache HIT —
      // it must not re-trigger a Nominatim request.
      if (row.latitude === null || row.longitude === null) return null
      return { latitude: row.latitude, longitude: row.longitude }
    }

    try {
      if (lastRequestAt !== undefined) {
        const wait = lastRequestAt + minGapMs - now()
        if (wait > 0) await sleep(wait)
      }
      lastRequestAt = now()

      const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(query)}`
      const res = await fetchImpl(url, { headers: { 'user-agent': NOMINATIM_USER_AGENT } })
      // A transient failure (non-OK response) is NOT cached — a future
      // retry should get a fresh chance rather than being stuck as a
      // permanent miss.
      if (!res.ok) return null
      const body = (await res.json()) as unknown
      if (!Array.isArray(body) || body.length === 0) return cacheMiss(query) // genuine "no result" — cache it
      const first = body[0] as { lat?: unknown; lon?: unknown }
      const latitude = Number(first.lat)
      const longitude = Number(first.lon)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return cacheMiss(query) // unusable result — cache it too

      await pool.query(
        `INSERT INTO geocode_cache (query, latitude, longitude) VALUES ($1, $2, $3)
         ON CONFLICT (query) DO NOTHING`,
        [query, latitude, longitude],
      )
      return { latitude, longitude }
    } catch {
      return null // fail-open: a network/transient failure is NOT cached, coordinates just stay missing this run
    }
  }
}
