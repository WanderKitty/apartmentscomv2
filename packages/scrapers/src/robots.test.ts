import { describe, expect, it } from 'vitest'
import { isPathAllowed, parseRobots, type RobotsPolicy } from './robots'

const TXT = `
User-agent: *
Disallow: /admin/
Disallow: /private
Crawl-delay: 5

User-agent: aptv2-research-bot
Disallow: /noapt/
Crawl-delay: 2
`

describe('parseRobots', () => {
  it('prefers the specific user-agent group over *', () => {
    const p = parseRobots(TXT, 'aptv2-research-bot/0.1 (+mailto:volodolzh@gmail.com)')
    expect(p.disallow).toEqual(['/noapt/'])
    expect(p.crawlDelaySeconds).toBe(2)
  })

  it('falls back to the * group', () => {
    const p = parseRobots(TXT, 'otherbot/1.0')
    expect(p.disallow).toEqual(['/admin/', '/private'])
    expect(p.crawlDelaySeconds).toBe(5)
  })

  it('empty or missing robots means everything allowed', () => {
    const p = parseRobots('', 'aptv2-research-bot')
    expect(p.disallow).toEqual([])
    expect(p.crawlDelaySeconds).toBeNull()
    expect(isPathAllowed(p, '/anything')).toBe(true)
  })
})

describe('isPathAllowed', () => {
  const p = parseRobots(TXT, 'otherbot')
  it('blocks prefix matches and allows the rest', () => {
    expect(isPathAllowed(p, '/admin/x')).toBe(false)
    expect(isPathAllowed(p, '/privateer')).toBe(false) // prefix match per robots convention
    expect(isPathAllowed(p, '/public/feed.json')).toBe(true)
  })
})

// Google REP semantics: Allow, `*` wildcards, `$` end-anchor, longest-match
// wins, Allow wins length ties. Examples mirror Google's own robots.txt
// spec documentation.
describe('parseRobots + isPathAllowed: Allow, wildcards, $ anchor (Google REP semantics)', () => {
  it('a longer, more specific Allow wins over a broader Disallow', () => {
    const p = parseRobots('User-agent: *\nDisallow: /wp-\nAllow: /wp-json/\n', '*')
    expect(p.allow).toEqual(['/wp-json/'])
    expect(isPathAllowed(p, '/wp-json/route')).toBe(true)
    expect(isPathAllowed(p, '/wp-admin/edit')).toBe(false)
  })

  it('a longer Disallow wins over a shorter Allow (Google example: /page vs /*.htm)', () => {
    const p = parseRobots('User-agent: *\nAllow: /page\nDisallow: /*.htm\n', '*')
    expect(isPathAllowed(p, '/page.htm')).toBe(false)
    expect(isPathAllowed(p, '/page')).toBe(true)
  })

  it('wildcard * matches any sequence: Disallow: /*?s= blocks any search-query path', () => {
    const p = parseRobots('User-agent: *\nDisallow: /*?s=\n', '*')
    expect(isPathAllowed(p, '/search?s=test')).toBe(false)
    expect(isPathAllowed(p, '/search')).toBe(true)
  })

  it('$ anchors the end of the pattern: Disallow: /*.php$ blocks the exact suffix only', () => {
    const p = parseRobots('User-agent: *\nDisallow: /*.php$\n', '*')
    expect(isPathAllowed(p, '/filename.php')).toBe(false)
    expect(isPathAllowed(p, '/filename.php?parameters')).toBe(true)
    expect(isPathAllowed(p, '/filename.phpx')).toBe(true)
  })

  it('equal-length Allow/Disallow ties favor Allow', () => {
    const p = parseRobots('User-agent: *\nAllow: /folder\nDisallow: /folder\n', '*')
    expect(isPathAllowed(p, '/folder/page')).toBe(true)
  })

  it('Allow: /$ matches only the exact root; a deeper path still hits the broad Disallow', () => {
    const p = parseRobots('User-agent: *\nAllow: /$\nDisallow: /\n', '*')
    expect(isPathAllowed(p, '/')).toBe(true)
    expect(isPathAllowed(p, '/page.htm')).toBe(false)
  })

  // Pinning test (review CRITICAL 1): every sources.robots_policy row
  // written before this task is JSONB with only {disallow,
  // crawlDelaySeconds} — no `allow` key at all. No data backfill is
  // planned, so isPathAllowed must not crash on that legacy shape.
  it('does not throw on a legacy stored policy with no `allow` key', () => {
    const legacyPolicy = { disallow: ['/admin'], crawlDelaySeconds: null } as RobotsPolicy
    expect(() => isPathAllowed(legacyPolicy, '/x')).not.toThrow()
    expect(isPathAllowed(legacyPolicy, '/x')).toBe(true)
  })
})
