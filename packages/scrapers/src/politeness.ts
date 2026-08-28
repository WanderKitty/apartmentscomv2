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

export type FetchOpts = { maxRps?: number }

/**
 * Coerces a `sources.rate_limit_rps` value (a `numeric` column — pg returns
 * it as a string) into a usable per-call `maxRps`. A non-finite or
 * non-positive value (0, negative, NaN, garbage) falls back to `undefined`
 * so the caller's default spacing applies, rather than silently disabling
 * rate limiting (`1000 / -1` is a negative gap, which floors to zero delay).
 */
export function coerceMaxRps(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export type PoliteFetcher = {
  fetchJson(url: string, policy: RobotsPolicy | null, opts?: FetchOpts): Promise<{ status: number; body: unknown }>
  fetchText(url: string, policy: RobotsPolicy | null, opts?: FetchOpts): Promise<{ status: number; body: string }>
}

export function createPoliteFetcher(
  opts: {
    fetchImpl?: typeof fetch
    now?: () => number
    sleep?: (ms: number) => Promise<void>
    maxRps?: number
    /** Default true (preserves prior behavior): a 429 is retried like a 5xx.
     * Discovery's verifier passes false — retrying a rate-limited candidate
     * site during a first-contact probe is impolite regardless of backoff;
     * a 429 should fail the probe immediately (terminal), not be hammered 3
     * times. 5xx retry behavior is unaffected either way. */
    retry429?: boolean
  } = {},
): PoliteFetcher {
  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const minGapMs = 1000 / (opts.maxRps ?? 1)
  const retry429 = opts.retry429 ?? true
  const lastRequestAt = new Map<string, number>()

  // ONE politeness path for every request kind: robots gate, per-domain
  // spacing, UA, retry with backoff. Body handling is the only variance.
  async function politeRequest(url: string, policy: RobotsPolicy | null, opts?: FetchOpts): Promise<Response> {
    const u = new URL(url)
    // Google REP matches against path+query, not path alone — a wildcard
    // rule like `Disallow: /*?s=` (see robots.ts's own tests) can only
    // ever fire against a live request if the query string is included.
    if (policy && !isPathAllowed(policy, u.pathname + u.search)) throw new RobotsDisallowedError(url)
    // A per-call maxRps (e.g. a source's own rate_limit_rps) overrides the
    // fetcher's default spacing for just this call; crawl-delay still wins
    // over either when it demands something slower.
    const callGapMs = opts?.maxRps ? 1000 / opts.maxRps : minGapMs
    const gapMs = Math.max(callGapMs, (policy?.crawlDelaySeconds ?? 0) * 1000)
    const last = lastRequestAt.get(u.hostname)
    if (last !== undefined) {
      const wait = last + gapMs - now()
      if (wait > 0) await sleep(wait)
    }
    let lastStatus = 0
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(Math.max(1000 * 2 ** attempt, gapMs)) // exponential backoff, never faster than crawl-delay
      lastRequestAt.set(u.hostname, now())
      const res = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT } })
      lastStatus = res.status
      if (res.status === 429 && !retry429) throw new Error(`rate limited (429), not retrying: ${url}`)
      if (res.status >= 500 || res.status === 429) continue
      return res
    }
    throw new Error(`fetch failed after 3 attempts (${lastStatus}): ${url}`)
  }

  return {
    async fetchJson(url, policy, callOpts) {
      const res = await politeRequest(url, policy, callOpts)
      const body = await res.json().catch(() => null)
      return { status: res.status, body }
    },
    async fetchText(url, policy, callOpts) {
      const res = await politeRequest(url, policy, callOpts)
      return { status: res.status, body: await res.text() }
    },
  }
}
