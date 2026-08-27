import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { createBoss } from './boss'
import { registerJobs, HEARTBEAT } from './jobs/heartbeat'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

const boss = createBoss(url)
boss.on('error', (err) => console.error('[pg-boss]', err))

await boss.start()
await registerJobs(boss)
await boss.work(HEARTBEAT, async ([job]) => {
  console.log('[heartbeat]', job!.id, job!.data)
})
await boss.schedule(HEARTBEAT, '*/15 * * * *', {})
console.log('Worker started; heartbeat scheduled every 15 minutes')
