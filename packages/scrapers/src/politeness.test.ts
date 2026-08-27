import { describe, expect, it, vi } from 'vitest'
import { RobotsDisallowedError, createPoliteFetcher, USER_AGENT, sha256Json } from './index'
import { parseRobots } from './robots'

function fakeFetch(responses: Array<{ status: number; body?: unknown }>) {
  let i = 0
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> })
    const r = responses[Math.min(i++, responses.length - 1)]!
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    })
  })
  return { impl: impl as unknown as typeof fetch, calls }
}

describe('createPoliteFetcher', () => {
  it('sends the identified User-Agent and parses JSON', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { ok: 1 } }])
    const f = createPoliteFetcher({ fetchImpl: impl, sleep: async () => {} })
    const r = await f.fetchJson('https://example.com/feed.json', null)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: 1 })
    expect(calls[0]!.headers['user-agent']).toBe(USER_AGENT)
  })

  it('refuses a robots-disallowed path without sending anything', async () => {
    const { impl } = fakeFetch([{ status: 200 }])
    const f = createPoliteFetcher({ fetchImpl: impl, sleep: async () => {} })
    const policy = parseRobots('User-agent: *\nDisallow: /feed', USER_AGENT)
    await expect(f.fetchJson('https://example.com/feed.json', policy)).rejects.toBeInstanceOf(
      RobotsDisallowedError,
    )
    expect(impl).not.toHaveBeenCalled()
  })

  it('spaces same-domain requests to the rate limit', async () => {
    const sleeps: number[] = []
    let clock = 0
    const { impl } = fakeFetch([{ status: 200 }, { status: 200 }])
    const f = createPoliteFetcher({
      fetchImpl: impl,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms)
        clock += ms
      },
    })
    await f.fetchJson('https://example.com/a', null)
    await f.fetchJson('https://example.com/b', null) // same domain, same instant → must wait ~1000ms
    expect(sleeps.some((ms) => ms >= 999)).toBe(true)
  })

  it('honors a crawl-delay larger than the default spacing', async () => {
    const sleeps: number[] = []
    let clock = 0
    const { impl } = fakeFetch([{ status: 200 }, { status: 200 }])
    const f = createPoliteFetcher({
      fetchImpl: impl,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms)
        clock += ms
      },
    })
    const policy = parseRobots('User-agent: *\nCrawl-delay: 5', USER_AGENT)
    await f.fetchJson('https://example.com/a', policy)
    await f.fetchJson('https://example.com/b', policy)
    expect(sleeps.some((ms) => ms >= 4999)).toBe(true)
  })

  it('retries 5xx with backoff then succeeds; gives up after 3 tries', async () => {
    const { impl } = fakeFetch([{ status: 503 }, { status: 503 }, { status: 200, body: { ok: 1 } }])
    const f = createPoliteFetcher({ fetchImpl: impl, sleep: async () => {} })
    const r = await f.fetchJson('https://example.com/flaky', null)
    expect(r.status).toBe(200)

    const always503 = fakeFetch([{ status: 503 }])
    const g = createPoliteFetcher({ fetchImpl: always503.impl, sleep: async () => {} })
    await expect(g.fetchJson('https://example.com/dead', null)).rejects.toThrow(/503/)
    expect(always503.impl).toHaveBeenCalledTimes(3)
  })
})

describe('fetchText', () => {
  it('shares the politeness path and returns raw text', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> })
      return new Response('User-agent: *\nDisallow: /x', { status: 200, headers: { 'content-type': 'text/plain' } })
    }) as unknown as typeof fetch
    const f = createPoliteFetcher({ fetchImpl: impl, sleep: async () => {} })
    const r = await f.fetchText('https://example.com/robots.txt', null)
    expect(r.status).toBe(200)
    expect(r.body).toContain('Disallow: /x')
    expect(calls[0]!.headers['user-agent']).toBe(USER_AGENT)
  })

  it('refuses a robots-disallowed path just like fetchJson', async () => {
    const impl = vi.fn() as unknown as typeof fetch
    const f = createPoliteFetcher({ fetchImpl: impl, sleep: async () => {} })
    const policy = parseRobots('User-agent: *\nDisallow: /secret', USER_AGENT)
    await expect(f.fetchText('https://example.com/secret.txt', policy)).rejects.toBeInstanceOf(
      RobotsDisallowedError,
    )
    expect(impl).not.toHaveBeenCalled()
  })
})

describe('sha256Json', () => {
  it('is stable under key order', () => {
    expect(sha256Json({ a: 1, b: [2, { c: 3, d: 4 }] })).toBe(
      sha256Json({ b: [2, { d: 4, c: 3 }], a: 1 }),
    )
    expect(sha256Json({ a: 1 })).not.toBe(sha256Json({ a: 2 }))
  })
})
