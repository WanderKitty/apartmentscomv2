import { describe, expect, it } from 'vitest'
import { runScrapePool, type ScrapeTask } from '../src/scrape-pool'

const task = (id: number, host: string): ScrapeTask => ({
  id,
  name: `s${id}`,
  endpointUrl: `https://${host}/feed.json`,
})
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('runScrapePool', () => {
  it('scrapes distinct hosts concurrently up to the bound', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const tasks = [1, 2, 3, 4, 5, 6].map((i) => task(i, `h${i}.example.com`))
    const res = await runScrapePool(
      tasks,
      async () => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await delay(20)
        inFlight--
        return true
      },
      3,
    )
    expect(res).toEqual({ succeeded: 6, failed: 0 })
    expect(maxInFlight).toBeGreaterThanOrEqual(2)
    expect(maxInFlight).toBeLessThanOrEqual(3)
  })

  it('never overlaps two scrapes of the same host', async () => {
    const inFlightByHost = new Map<string, number>()
    let overlapped = false
    const tasks = [task(1, 'same.com'), task(2, 'same.com'), task(3, 'other.com'), task(4, 'same.com')]
    await runScrapePool(
      tasks,
      async (t) => {
        const host = new URL(t.endpointUrl).host
        const n = (inFlightByHost.get(host) ?? 0) + 1
        inFlightByHost.set(host, n)
        if (n > 1) overlapped = true
        await delay(20)
        inFlightByHost.set(host, inFlightByHost.get(host)! - 1)
        return true
      },
      4,
    )
    expect(overlapped).toBe(false)
  })

  it('one failing source never stops the rest', async () => {
    const tasks = [1, 2, 3].map((i) => task(i, `h${i}.com`))
    const res = await runScrapePool(tasks, async (t) => t.id !== 2, 2)
    expect(res).toEqual({ succeeded: 2, failed: 1 })
  })

  it('an unparseable endpoint url still runs', async () => {
    const bad: ScrapeTask = { id: 9, name: 's9', endpointUrl: 'not a url' }
    const res = await runScrapePool([bad], async () => true, 4)
    expect(res).toEqual({ succeeded: 1, failed: 0 })
  })
})
