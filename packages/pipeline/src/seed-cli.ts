import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { getPool, closePool } from '@aptv2/db'
import { buildSeedUnits } from '@aptv2/schema'
import { seedNeighborhoods, upsertProcessedUnits } from './index'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

const pool = getPool()
const hoods = await seedNeighborhoods(pool)
const counts = await upsertProcessedUnits(pool, buildSeedUnits(new Date()))
console.log(
  `Seeded ${hoods} neighborhoods, ${counts.properties} properties, ` +
  `${counts.units} units, ${counts.listings} listings`,
)
await closePool()
