import type pg from 'pg'
import { SOURCE_ID_SEPARATOR, type ProcessedUnitData } from '@aptv2/schema'

// The proto-normalize stage (spec §5.4): schema-validated records →
// properties/units/listings rows, idempotent on natural keys. Plan 4's
// pipeline calls this exact function with extracted (non-seed) records.

const normalizedAddress = (u: ProcessedUnitData) =>
  `${u.address_line1} ${u.city} ${u.state} ${u.zip}`.toLowerCase().replace(/\s+/g, ' ')

// Trust/completeness (spec §5.5), ported from the demo's in-memory scorer.
function trustScore(u: ProcessedUnitData): number {
  return (
    (u.advertised_rent_cents !== null ? 0.35 : 0) +
    (u.price_level === 'unit' ? 0.25 : 0) +
    (u.sqft !== null ? 0.15 : 0) +
    (u.generated_summary ? 0.15 : 0) +
    (u.unit_amenities.length + u.community_amenities.length > 0 ? 0.1 : 0)
  )
}

function leaseTerm(u: ProcessedUnitData): 'short' | 'long' | 'both' | 'unknown' {
  if (u.short_term_ok === true) return 'both'
  if (u.short_term_ok === false) return 'long'
  return 'unknown'
}

function moveInFees(u: ProcessedUnitData): Array<{ label: string; amount_cents: number }> {
  const fees: Array<{ label: string; amount_cents: number }> = []
  if (u.application_fee_cents) fees.push({ label: 'Application fee', amount_cents: u.application_fee_cents })
  if (u.admin_fee_cents) fees.push({ label: 'Admin fee', amount_cents: u.admin_fee_cents })
  if (u.security_deposit_cents)
    fees.push({
      label: `Security deposit${u.security_deposit_refundable ? ' (refundable)' : ''}`,
      amount_cents: u.security_deposit_cents,
    })
  if (u.pet_deposit_cents) fees.push({ label: 'Pet deposit', amount_cents: u.pet_deposit_cents })
  return fees
}

function concessionJson(u: ProcessedUnitData) {
  if (!['free_weeks', 'free_months', 'flat_discount'].includes(u.concession_type)) return null
  return {
    type: u.concession_type,
    free_weeks: u.concession_free_weeks,
    free_months: u.concession_free_months,
    value_cents: u.concession_value_cents,
    lease_months: u.concession_applies_lease_months,
  }
}

export async function upsertProcessedUnits(
  pool: pg.Pool,
  units: ProcessedUnitData[],
): Promise<{ properties: number; units: number; listings: number }> {
  const propertyIds = new Set<number>()
  const unitIds = new Set<number>()
  let listings = 0

  for (const u of units) {
    const { rows: hood } = await pool.query(
      `SELECT id FROM neighborhoods WHERE metro = 'orlando' AND name = $1`,
      [u.neighborhood],
    )
    const neighborhoodId: number | null = hood[0]?.id ?? null

    const { rows: prop } = await pool.query(
      `INSERT INTO properties
         (name, address_line1, city, state, zip, normalized_address, location,
          neighborhood_id, amenities, management_company, website_url, first_seen_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography,
               $9, $10, $11, $12, $13, $14)
       ON CONFLICT (normalized_address) DO UPDATE SET
         name = EXCLUDED.name,
         neighborhood_id = EXCLUDED.neighborhood_id,
         amenities = EXCLUDED.amenities,
         management_company = EXCLUDED.management_company,
         last_seen_at = GREATEST(properties.last_seen_at, EXCLUDED.last_seen_at)
       RETURNING id`,
      [
        u.property_name, u.address_line1, u.city, u.state, u.zip, normalizedAddress(u),
        u.longitude, u.latitude, neighborhoodId, u.community_amenities,
        u.management_company, u.source_url, u.first_seen_at, u.last_confirmed_at,
      ],
    )
    const propertyId: number = prop[0]!.id
    propertyIds.add(propertyId)

    const sourceExternalId = u.source_id.split(SOURCE_ID_SEPARATOR)[1] ?? u.source_id
    const kind = u.unit_number ? 'unit' : 'floorplan'
    const externalId = u.unit_number ?? u.floorplan_name ?? sourceExternalId
    const { rows: unit } = await pool.query(
      `INSERT INTO units (property_id, kind, external_id, name, beds, baths, sqft, amenities)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (property_id, kind, external_id) DO UPDATE SET
         beds = EXCLUDED.beds, baths = EXCLUDED.baths, sqft = EXCLUDED.sqft,
         amenities = EXCLUDED.amenities
       RETURNING id`,
      [propertyId, kind, externalId, u.floorplan_name, u.beds, u.baths, u.sqft, u.unit_amenities],
    )
    const unitId: number = unit[0]!.id
    unitIds.add(unitId)

    const priceHistory = u.events
      .filter((e) => (e.kind === 'price_drop' || e.kind === 'price_increase') && e.from_cents !== null && e.to_cents !== null)
      .map((e) => ({ at: e.at, from_cents: e.from_cents, to_cents: e.to_cents }))
    const searchText = [
      u.property_name, u.neighborhood, u.generated_summary ?? '',
      ...u.unit_amenities, ...u.community_amenities,
    ].join(' ')

    await pool.query(
      `INSERT INTO listings
         (unit_id, property_id, neighborhood_id, location, price_cents, price_is_starting_at,
          net_effective_rent_cents, concessions_text, available_on, lease_term, furnished,
          status, first_listed_at, last_confirmed_at, price_history, price_changes,
          trust_score, search_text, collapse_key, dedup_cluster, source_platform,
          source_external_id, source_url, provenance, estimated_publish_date, description,
          events, move_in_fees, concession)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7,
               $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
               $23, $24, $25, $26, $27, $28, $29, $30)
       ON CONFLICT (collapse_key) DO UPDATE SET
         price_cents = EXCLUDED.price_cents,
         price_is_starting_at = EXCLUDED.price_is_starting_at,
         net_effective_rent_cents = EXCLUDED.net_effective_rent_cents,
         concessions_text = EXCLUDED.concessions_text,
         available_on = EXCLUDED.available_on,
         lease_term = EXCLUDED.lease_term,
         furnished = EXCLUDED.furnished,
         status = EXCLUDED.status,
         last_confirmed_at = EXCLUDED.last_confirmed_at,
         price_history = EXCLUDED.price_history,
         price_changes = EXCLUDED.price_changes,
         trust_score = EXCLUDED.trust_score,
         search_text = EXCLUDED.search_text,
         dedup_cluster = EXCLUDED.dedup_cluster,
         events = EXCLUDED.events,
         move_in_fees = EXCLUDED.move_in_fees,
         concession = EXCLUDED.concession,
         description = EXCLUDED.description`,
      [
        unitId, propertyId, neighborhoodId, u.longitude, u.latitude,
        u.advertised_rent_cents, u.price_level === 'floorplan_starting_at',
        u.net_effective_monthly_cents, u.concession_text_raw, u.available_on,
        leaseTerm(u), u.furnished === 'furnished', u.listing_status,
        u.first_seen_at, u.last_confirmed_at, JSON.stringify(priceHistory),
        priceHistory.length, trustScore(u), searchText, u.collapse_key,
        u.liberal_dedup_cluster, u.platform, sourceExternalId, u.source_url,
        u.data_provenance, u.estimated_publish_date, u.generated_summary,
        JSON.stringify(u.events), JSON.stringify(moveInFees(u)),
        JSON.stringify(concessionJson(u)),
      ],
    )
    listings++
  }
  return { properties: propertyIds.size, units: unitIds.size, listings }
}
