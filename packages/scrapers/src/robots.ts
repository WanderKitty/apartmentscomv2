// Minimal robots.txt parser (spec §7): user-agent groups, Disallow
// prefixes, Crawl-delay. The bot token (text before "/") selects the
// most specific matching group; "*" is the fallback.

export type RobotsPolicy = {
  disallow: string[]
  crawlDelaySeconds: number | null
}

export function parseRobots(txt: string, userAgent: string): RobotsPolicy {
  const botToken = userAgent.split('/')[0]!.trim().toLowerCase()
  type Group = { agents: string[]; disallow: string[]; crawlDelay: number | null }
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
        current = { agents: [], disallow: [], crawlDelay: null }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastLineWasAgent = true
      continue
    }
    lastLineWasAgent = false
    if (!current) continue
    if (field === 'disallow' && value) current.disallow.push(value)
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
    crawlDelaySeconds: chosen?.crawlDelay ?? null,
  }
}

export function isPathAllowed(policy: RobotsPolicy, path: string): boolean {
  return !policy.disallow.some((prefix) => path.startsWith(prefix))
}
