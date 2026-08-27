import { describe, it, expect, afterAll } from 'vitest'
import { createBoss } from '../src/boss'
import { registerJobs, HEARTBEAT } from '../src/jobs/heartbeat'

const boss = createBoss(process.env.TEST_DATABASE_URL!)

afterAll(async () => {
  await boss.stop({ graceful: false })
})

describe('pg-boss queue', () => {
  it('round-trips a heartbeat job', async () => {
    await boss.start()
    await registerJobs(boss)

    let resolve!: (v: unknown) => void
    const handled = new Promise((r) => (resolve = r))
    await boss.work(HEARTBEAT, async ([job]) => {
      resolve(job!.data)
    })

    await boss.send(HEARTBEAT, { ping: 1 })
    const data = await handled
    expect(data).toEqual({ ping: 1 })
  })
})
