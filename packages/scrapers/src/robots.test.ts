import { describe, expect, it } from 'vitest'
import { isPathAllowed, parseRobots } from './robots'

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
