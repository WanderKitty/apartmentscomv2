import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { getPool, closePool } from '@aptv2/db'
import { seedSources } from './sources-seed'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

const pool = getPool()
const count = await seedSources(pool)
console.log(`Seeded ${count} sources`)
await closePool()
