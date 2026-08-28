export type ScrapeTask = { id: number; name: string; endpointUrl: string }

const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return url // unparseable → its own serial group
  }
}

/**
 * Run scrape tasks with bounded concurrency ACROSS hostnames while keeping
 * tasks that share a hostname strictly sequential — the politeness fetcher
 * spaces requests per host and assumes callers don't race the same host.
 * runOne must never throw: it returns success as a boolean (failures are
 * already recorded in scrape_runs by the caller).
 */
export async function runScrapePool(
  tasks: ScrapeTask[],
  runOne: (t: ScrapeTask) => Promise<boolean>,
  concurrency = 4,
): Promise<{ succeeded: number; failed: number }> {
  const groups = new Map<string, ScrapeTask[]>()
  for (const t of tasks) {
    const host = hostOf(t.endpointUrl)
    const group = groups.get(host) ?? []
    group.push(t)
    groups.set(host, group)
  }
  const queues = [...groups.values()]
  let succeeded = 0
  let failed = 0
  let next = 0
  const worker = async () => {
    while (next < queues.length) {
      const queue = queues[next++]!
      for (const t of queue) {
        if (await runOne(t)) succeeded++
        else failed++
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queues.length) }, () => worker()))
  return { succeeded, failed }
}
