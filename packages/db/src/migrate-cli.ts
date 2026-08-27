import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { getPool, closePool } from './client'
import { runMigrations } from './migrate'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

const dir = fileURLToPath(new URL('../migrations', import.meta.url))
const applied = await runMigrations(getPool(), dir)
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Up to date')
await closePool()
