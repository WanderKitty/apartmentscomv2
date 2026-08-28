import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Pool } from 'pg'
import { resetTestDb } from '@aptv2/db/test-helpers'
import { createNominatimGeocoder } from '../src/geocode'

let pool: Pool
beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await resetTestDb(pool)
})
afterAll(async () => {
  await pool.end()
})

function fakeFetch(body: unknown) {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response)
}

describe('createNominatimGeocoder', () => {
  it('geocodes a query, caches it in geocode_cache, and reuses the cache on a repeat call', async () => {
    const fetchImpl = fakeFetch([{ lat: '28.548', lon: '-81.379' }])
    const geocode = createNominatimGeocoder(pool, { fetchImpl, sleep: vi.fn(async () => {}) })

    const first = await geocode('410 N Orange Ave, Orlando, FL 32801')
    expect(first).toEqual({ latitude: 28.548, longitude: -81.379 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const { rows } = await pool.query(`SELECT latitude, longitude FROM geocode_cache WHERE query = $1`, [
      '410 N Orange Ave, Orlando, FL 32801',
    ])
    expect(rows).toEqual([{ latitude: 28.548, longitude: -81.379 }])

    const second = await geocode('410 N Orange Ave, Orlando, FL 32801')
    expect(second).toEqual({ latitude: 28.548, longitude: -81.379 })
    expect(fetchImpl).toHaveBeenCalledTimes(1) // cache hit — no second network call
  })

  it('paces requests to the same host at ≤1 req/s', async () => {
    const fetchImpl = fakeFetch([{ lat: '1', lon: '2' }])
    const sleep = vi.fn(async (_ms: number) => {})
    let now = 0
    const geocode = createNominatimGeocoder(pool, { fetchImpl, sleep, now: () => now })

    await geocode('query-a-for-pacing-test')
    now += 100 // well under 1000ms
    await geocode('query-b-for-pacing-test')

    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep.mock.calls[0]![0]).toBeGreaterThanOrEqual(900)
  })

  it('fails open (returns null) when the fetch throws or Nominatim has no results', async () => {
    const throwing = createNominatimGeocoder(pool, {
      fetchImpl: vi.fn(async () => {
        throw new Error('network down')
      }),
      sleep: vi.fn(async () => {}),
    })
    expect(await throwing('unreachable query')).toBeNull()

    const empty = createNominatimGeocoder(pool, { fetchImpl: fakeFetch([]), sleep: vi.fn(async () => {}) })
    expect(await empty('nowhere query')).toBeNull()
  })
})
