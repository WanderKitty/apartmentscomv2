import { createHash } from 'node:crypto'
import { isPathAllowed, type RobotsPolicy } from './robots'

// Politeness is enforced centrally (spec §5.2): adapters cannot reach the
// network except through this fetcher.

export const USER_AGENT = 'aptv2-research-bot/0.1 (+mailto:volodolzh@gmail.com)'

export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`robots.txt disallows ${url}`)
    this.name = 'RobotsDisallowedError'
  }
}

const stableStringify = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, val]) => `${JSON.stringify(k)}:${stableStringify(val)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(v)
}

export function sha256Json(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

export type PoliteFetcher = {
  fetchJson(url: string, policy: RobotsPolicy | null): Promise<{ status: number; body: unknown }>
  fetchText(url: string, policy: RobotsPolicy | null): Promise<{ status: number; body: string }>
}

export function createPoliteFetcher(
  opts: {
    fetchImpl?: typeof fetch
    now?: () => number
    sleep?: (ms: number) => Promise<void>
    maxRps?: number
  } = {},
): PoliteFetcher {
  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const minGapMs = 1000 / (opts.maxRps ?? 1)
  const lastRequestAt = new Map<string, number>()

  // ONE politeness path for every request kind: robots gate, per-domain
  // spacing, UA, retry with backoff. Body handling is the only variance.
  async function politeRequest(url: string, policy: RobotsPolicy | null): Promise<Response> {
    const u = new URL(url)
    if (policy && !isPathAllowed(policy, u.pathname)) throw new RobotsDisallowedError(url)
    const gapMs = Math.max(minGapMs, (policy?.crawlDelaySeconds ?? 0) * 1000)
    const last = lastRequestAt.get(u.hostname)
    if (last !== undefined) {
      const wait = last + gapMs - now()
      if (wait > 0) await sleep(wait)
    }
    let lastStatus = 0
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(1000 * 2 ** attempt) // exponential backoff
      lastRequestAt.set(u.hostname, now())
      const res = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT } })
      lastStatus = res.status
      if (res.status >= 500 || res.status === 429) continue
      return res
    }
    throw new Error(`fetch failed after 3 attempts (${lastStatus}): ${url}`)
  }

  return {
    async fetchJson(url, policy) {
      const res = await politeRequest(url, policy)
      const body = await res.json().catch(() => null)
      return { status: res.status, body }
    },
    async fetchText(url, policy) {
      const res = await politeRequest(url, policy)
      return { status: res.status, body: await res.text() }
    },
  }
}
