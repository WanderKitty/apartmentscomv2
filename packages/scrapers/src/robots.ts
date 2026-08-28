// Minimal robots.txt parser (spec §7): user-agent groups, Disallow/Allow
// prefixes (with `*` wildcards and a trailing `$` anchor — Google REP
// semantics), Crawl-delay. The bot token (text before "/") selects the
// most specific matching group; "*" is the fallback.

export type RobotsPolicy = {
  disallow: string[]
  allow: string[]
  crawlDelaySeconds: number | null
}

export function parseRobots(txt: string, userAgent: string): RobotsPolicy {
  const botToken = userAgent.split('/')[0]!.trim().toLowerCase()
  type Group = { agents: string[]; disallow: string[]; allow: string[]; crawlDelay: number | null }
  const groups: Group[] = []
  let current: Group | null = null
  let lastLineWasAgent = false
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const field = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (field === 'user-agent') {
      if (!lastLineWasAgent || !current) {
        current = { agents: [], disallow: [], allow: [], crawlDelay: null }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastLineWasAgent = true
      continue
    }
    lastLineWasAgent = false
    if (!current) continue
    if (field === 'disallow' && value) current.disallow.push(value)
    if (field === 'allow' && value) current.allow.push(value)
    if (field === 'crawl-delay') {
      const n = Number(value)
      if (Number.isFinite(n)) current.crawlDelay = n
    }
  }
  const specific = groups.find((g) => g.agents.some((a) => a !== '*' && botToken.includes(a)))
  const wildcard = groups.find((g) => g.agents.includes('*'))
  const chosen = specific ?? wildcard
  return {
    disallow: chosen?.disallow ?? [],
    allow: chosen?.allow ?? [],
    crawlDelaySeconds: chosen?.crawlDelay ?? null,
  }
}

// Converts a robots.txt path pattern to an anchored regex: `*` matches any
// sequence, a trailing `$` anchors the end, everything else is literal
// (escaped). Matching always starts at the beginning of the path (robots
// patterns are prefixes unless `$`-anchored).
function patternToRegex(pattern: string): RegExp {
  const endAnchored = pattern.endsWith('$')
  const body = endAnchored ? pattern.slice(0, -1) : pattern
  const escapeLiteral = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regexBody = body.split('*').map(escapeLiteral).join('.*')
  return new RegExp(`^${regexBody}${endAnchored ? '$' : ''}`)
}

/**
 * Google REP semantics: the longest matching pattern (by literal pattern
 * length) wins regardless of Allow/Disallow; an exact-length tie goes to
 * Allow. No match at all means allowed (the old prefix-only behavior falls
 * out of this as the no-wildcard, no-Allow special case).
 */
export function isPathAllowed(policy: RobotsPolicy, path: string): boolean {
  type Match = { length: number; allow: boolean }
  // `allow` is guarded at point of use: every `sources.robots_policy` row
  // written before this task is JSONB with only {disallow,
  // crawlDelaySeconds} — no data backfill, so a legacy row must not crash
  // here (it would otherwise TypeError on every scrape until a fresh 200
  // robots.txt refresh rewrites the stored policy).
  const allowPatterns = policy.allow ?? []
  const matches: Match[] = [
    ...policy.disallow.filter((p) => patternToRegex(p).test(path)).map((p) => ({ length: p.length, allow: false })),
    ...allowPatterns.filter((p) => patternToRegex(p).test(path)).map((p) => ({ length: p.length, allow: true })),
  ]
  if (matches.length === 0) return true
  matches.sort((a, b) => b.length - a.length || (a.allow === b.allow ? 0 : a.allow ? -1 : 1))
  return matches[0]!.allow
}
