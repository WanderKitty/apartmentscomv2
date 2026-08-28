import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { usePerPackageTestDb } from '@aptv2/db/test-helpers'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })
await usePerPackageTestDb('evals')
