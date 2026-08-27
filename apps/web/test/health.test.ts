import { describe, it, expect, beforeAll, afterAll } from 'vitest'

beforeAll(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
})
afterAll(async () => {
  const { closePool } = await import('@aptv2/db')
  await closePool()
})

describe('GET /api/health', () => {
  it('reports db up', async () => {
    const { GET } = await import('../app/api/health/route')
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, db: 'up' })
  })
})
