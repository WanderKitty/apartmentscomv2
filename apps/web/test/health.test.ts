// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

beforeAll(() => {
  config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })
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
