import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { resetTestDb } from '@aptv2/db/test-helpers'
import { RobotsDisallowedError, type PoliteFetcher } from '@aptv2/scrapers'
import { runDiscoverCli } from '../src/discover-cli'

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))

let pool: Pool
let dir: string
beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await resetTestDb(pool)
})
afterAll(async () => {
  await pool.end()
  if (dir) await rm(dir, { recursive: true, force: true })
})
beforeEach(async () => {
  await pool.query('DELETE FROM sources')
  dir = await mkdtemp(path.join(tmpdir(), 'discover-cli-test-'))
})

type Canned = { status: number; body?: unknown; text?: string } | 'robots-disallow'

function fakeFetcher(responses: Record<string, Canned>): PoliteFetcher {
  const lookup = (url: string): Canned => {
    const hit = responses[url]
    if (!hit) throw new Error(`unexpected fetch: ${url}`)
    return hit
  }
  return {
    async fetchText(url) {
      const r = lookup(url)
      if (r === 'robots-disallow') throw new RobotsDisallowedError(url)
      return { status: r.status, body: r.text ?? '' }
    },
    async fetchJson(url) {
      const r = lookup(url)
      if (r === 'robots-disallow') throw new RobotsDisallowedError(url)
      return { status: r.status, body: r.body }
    },
  }
}

/** Wraps a fetcher to count every fetchText/fetchJson call made through it. */
function countingFetcher(inner: PoliteFetcher): { fetcher: PoliteFetcher; count: () => number } {
  let n = 0
  return {
    fetcher: {
      fetchText: (...args) => {
        n++
        return inner.fetchText(...args)
      },
      fetchJson: (...args) => {
        n++
        return inner.fetchJson(...args)
      },
    },
    count: () => n,
  }
}

function orlandoLdJson(name: string) {
  return `<script type="application/ld+json">{"@context":"https://schema.org","@type":"ApartmentComplex","name":"${name}","address":{"@type":"PostalAddress","streetAddress":"1 Test Blvd","addressLocality":"Orlando","addressRegion":"FL","postalCode":"32801"},"geo":{"@type":"GeoCoordinates","latitude":"28.5","longitude":"-81.4"}}</script>`
}
const ORLANDO_LD_JSON = orlandoLdJson('CLI Test Community')
function embeddedV1Html(ldJson: string = ORLANDO_LD_JSON) {
  return `<html><head></head><body>${ldJson}<script type="application/json" id="jd-fp-data-script-app">{"units":[{"id_value":1,"bedrooms":"1","bathrooms":"1"}]}</script></body></html>`
}
const PERMISSIVE_ROBOTS = { status: 200, text: 'User-agent: *\nDisallow:\n' }
const NO_ROBOTS_FILE = { status: 404, text: '' }
const PLAIN_HOMEPAGE = { status: 200, text: '<html><body>not entrata</body></html>' }

describe('runDiscoverCli', () => {
  it('processes candidates sequentially, logs progress, writes a tally + report, verdict counts correct', async () => {
    const candidatesPath = path.join(dir, 'candidates.json')
    await writeFile(
      candidatesPath,
      JSON.stringify([
        { url: 'https://cli-a.example.com/', metro: 'Orlando', note: 'test' },
        { url: 'https://cli-b.example.com/', metro: 'Orlando' },
      ]),
    )
    const fetcher = fakeFetcher({
      'https://cli-a.example.com/robots.txt': PERMISSIVE_ROBOTS,
      'https://cli-a.example.com/': { status: 200, text: embeddedV1Html() },
      'https://cli-b.example.com/robots.txt': NO_ROBOTS_FILE,
      'https://cli-b.example.com/': PLAIN_HOMEPAGE,
      'https://cli-b.example.com/floor-plans/': PLAIN_HOMEPAGE,
    })
    const logLines: string[] = []
    const reportPath = path.join(dir, 'report.json')
    const out = await runDiscoverCli(candidatesPath, {
      pool,
      fetcher,
      log: (l) => logLines.push(l),
      reportPath,
    })

    expect(out.results).toHaveLength(2)
    expect(out.tally.registered).toBe(1)
    expect(out.tally.not_entrata).toBe(1)
    expect(logLines.some((l) => l.includes('cli-a.example.com') && l.includes('registered'))).toBe(true)
    expect(logLines.some((l) => l.includes('cli-b.example.com') && l.includes('not_entrata'))).toBe(true)

    const written = JSON.parse(await readFile(reportPath, 'utf8'))
    expect(written.tally.registered).toBe(1)
    expect(written.results).toHaveLength(2)
  })

  it('is idempotent by website_url across two full runs (no duplicate sources rows)', async () => {
    const candidatesPath = path.join(dir, 'candidates.json')
    await writeFile(candidatesPath, JSON.stringify([{ url: 'https://cli-idem.example.com/', metro: 'Orlando' }]))
    const fetcher = fakeFetcher({
      'https://cli-idem.example.com/robots.txt': PERMISSIVE_ROBOTS,
      'https://cli-idem.example.com/': { status: 200, text: embeddedV1Html() },
    })
    const reportPath1 = path.join(dir, 'report1.json')
    const reportPath2 = path.join(dir, 'report2.json')
    await runDiscoverCli(candidatesPath, { pool, fetcher, reportPath: reportPath1 })
    await runDiscoverCli(candidatesPath, { pool, fetcher, reportPath: reportPath2 })

    const { rows } = await pool.query(`SELECT * FROM sources WHERE website_url = $1`, ['https://cli-idem.example.com/'])
    expect(rows).toHaveLength(1)
  })

  it('review minor: the default report path is pinned to the package directory, not process.cwd()', async () => {
    const candidatesPath = path.join(dir, 'candidates.json')
    await writeFile(candidatesPath, JSON.stringify([]))
    const out = await runDiscoverCli(candidatesPath, { pool, fetcher: fakeFetcher({}) })
    try {
      expect(out.reportPath.startsWith(PACKAGE_DIR)).toBe(true)
      const written = JSON.parse(await readFile(out.reportPath, 'utf8'))
      expect(written.results).toEqual([])
    } finally {
      await rm(out.reportPath, { force: true })
    }
  })

  it('review C1: 35 candidates on the SAME host (a willowbridgepc.com-style shared-domain portfolio) cost exactly ONE robots.txt fetch total', async () => {
    const HOST = 'https://willowbridge-test.example.com'
    const candidates = Array.from({ length: 35 }, (_, i) => ({
      url: `${HOST}/properties/community-${i}`,
      metro: 'Orlando',
    }))
    const candidatesPath = path.join(dir, 'candidates.json')
    await writeFile(candidatesPath, JSON.stringify(candidates))

    const responses: Record<string, { status: number; text: string }> = {
      [`${HOST}/robots.txt`]: { status: 200, text: 'User-agent: *\nDisallow:\n' },
    }
    for (const c of candidates) {
      responses[c.url] = { status: 200, text: embeddedV1Html(orlandoLdJson(c.url)) }
    }
    const { fetcher, count } = countingFetcher(fakeFetcher(responses))
    const reportPath = path.join(dir, 'report-shared-host.json')
    const out = await runDiscoverCli(candidatesPath, { pool, fetcher, reportPath })

    expect(out.tally.registered).toBe(35)
    // 1 robots.txt fetch + 35 homepage fetches (each homepage fully
    // resolves via its own embedded-v1 fingerprint — no floor-plans probe,
    // no separate endpoint request) = 36 total, not 35 * (1 robots + 1
    // homepage) = 70.
    expect(count()).toBe(36)
  })
})
