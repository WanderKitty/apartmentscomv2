import type pg from 'pg'
import type { SourceRow } from '@aptv2/scrapers'

export const SOURCES_SEED: Array<{
  platform: 'entrata'
  name: string
  website_url: string
  endpoint_config: SourceRow['endpoint_config']
  rate_limit_rps: number
}> = [
  {
    platform: 'entrata',
    name: 'Current Orlando',
    website_url: 'https://www.currentorlando.com',
    endpoint_config: {
      endpoint_url: 'https://www.currentorlando.com/wp-json/entrata/v3/termrent-floor-plans',
      property: {
        name: 'Current Orlando',
        address_line1: '4750 Data Ct',
        city: 'Orlando',
        state: 'FL',
        zip: '32817',
        latitude: 28.608,
        longitude: -81.214,
      },
    },
    rate_limit_rps: 1,
  },
  {
    platform: 'entrata',
    name: 'Society Orlando',
    website_url: 'https://societyorlando.com',
    endpoint_config: {
      endpoint_url: 'https://societyorlando.com/floorplans/',
      property: {
        name: 'Society Orlando',
        address_line1: '410 N Orange Ave',
        city: 'Orlando',
        state: 'FL',
        zip: '32801',
        latitude: 28.548,
        longitude: -81.379,
      },
    },
    rate_limit_rps: 1,
  },
  {
    platform: 'entrata',
    name: 'Aperture',
    website_url: 'https://apertureorlando.com',
    endpoint_config: {
      endpoint_url: 'https://apertureorlando.com/floor-plans/',
      property: {
        name: 'Aperture',
        address_line1: '12727 E Colonial Dr',
        city: 'Orlando',
        state: 'FL',
        zip: '32826',
        latitude: 28.565,
        longitude: -81.189,
      },
    },
    rate_limit_rps: 1,
  },
  {
    platform: 'entrata',
    name: 'Knightsbridge at Stoneybrook',
    website_url: 'https://www.liveatknightsbridge.com',
    endpoint_config: {
      endpoint_url: 'https://www.liveatknightsbridge.com/floor-plans/',
      property: {
        name: 'Knightsbridge at Stoneybrook',
        address_line1: '2802 Cheval St',
        city: 'Orlando',
        state: 'FL',
        zip: '32828',
        latitude: 28.514,
        longitude: -81.178,
      },
    },
    rate_limit_rps: 1,
  },
]

export async function seedSources(pool: pg.Pool): Promise<number> {
  let n = 0
  for (const s of SOURCES_SEED) {
    await pool.query(
      `INSERT INTO sources (platform, name, website_url, endpoint_config, rate_limit_rps)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (website_url) DO UPDATE SET
         name = EXCLUDED.name, endpoint_config = EXCLUDED.endpoint_config,
         rate_limit_rps = EXCLUDED.rate_limit_rps
       RETURNING id`,
      [s.platform, s.name, s.website_url, JSON.stringify(s.endpoint_config), s.rate_limit_rps],
    )
    n++
  }
  return n
}
