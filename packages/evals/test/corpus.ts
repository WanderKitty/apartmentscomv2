import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'
import { resetTestDb } from '@aptv2/db/test-helpers'
import { buildSeedUnits } from '@aptv2/schema'
import { seedNeighborhoods, upsertProcessedUnits, extractSnapshot } from '@aptv2/pipeline'
import type { SourceRow } from '@aptv2/scrapers'

/**
 * Load the full local corpus into the test database: the 26 seed listings
 * plus the captured Entrata REST fixture extracted with the LLM disabled.
 * Deterministic and key-free.
 */
export async function loadFullCorpus(pool: Pool, now: Date): Promise<void> {
  await resetTestDb(pool)
  await seedNeighborhoods(pool)
  await upsertProcessedUnits(pool, buildSeedUnits(now))
  const payload = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../scrapers/fixtures/entrata-availability.json', import.meta.url)),
      'utf8',
    ),
  )
  const { rows } = await pool.query(
    `INSERT INTO sources (platform, name, website_url, endpoint_config)
     VALUES ('entrata', 'Fixture Community', 'https://example.com',
             '{"endpoint_url":"https://example.com/feed.json","property":{"name":"Fixture Community","address_line1":"1 Fixture St","city":"Orlando","state":"FL","zip":"32801","latitude":28.54,"longitude":-81.38}}')
     RETURNING id`,
  )
  const source = (await pool.query(`SELECT * FROM sources WHERE id = $1`, [rows[0].id])).rows[0] as SourceRow
  const { units, failures } = await extractSnapshot(pool, {
    snapshot: { id: 1, source_id: source.id, payload },
    source,
    now,
    llm: null,
  })
  if (failures.length > 0) throw new Error(`fixture extraction failed: ${JSON.stringify(failures)}`)
  await upsertProcessedUnits(pool, units, { sourceRef: source.id })
}
