import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { getPool, closePool } from '@aptv2/db'
import { seedNeighborhoods } from './neighborhoods'
import { seedSources } from './sources-seed'

// Production seeding: geography + source registry ONLY. Listings arrive
// exclusively through the scrape pipeline (user ruling: prod corpus is
// real scraped data, never demo seed rows). Exits nonzero if any seed
// listing is found in the target database.
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

const pool = getPool()
const hoods = await seedNeighborhoods(pool)
const sources = await seedSources(pool)
const { rows } = await pool.query(`SELECT count(*)::int AS n FROM listings WHERE provenance = 'seed'`)
console.log(`Seeded ${hoods} neighborhoods, ${sources} sources; seed listings in DB: ${rows[0].n} (must be 0)`)
await closePool()
if (rows[0].n !== 0) process.exit(1)
