import { z } from "zod";

export const SOURCE_ID_SEPARATOR = "___";

const cents = z.number().int().nonnegative();
const centsNullable = cents.nullable();
const nm = z.boolean(); // is_X_not_mentioned companion

export const UNIT_AMENITIES = [
  "in-unit laundry", "washer-dryer hookups", "dishwasher", "balcony",
  "walk-in closet", "stainless appliances", "hardwood floors", "smart lock",
  "central air", "ceiling fans",
] as const;

export const COMMUNITY_AMENITIES = [
  "pool", "gym", "pet friendly", "dog park", "parking", "garage",
  "ev charging", "package lockers", "coworking", "rooftop", "gated",
  "elevator", "playground",
] as const;

export const LISTING_EVENT_KINDS = [
  "first_listed", "price_drop", "price_increase",
  "concession_added", "concession_removed", "confirmed",
] as const;

export const ListingEventSchema = z.object({
  at: z.string().datetime(),
  kind: z.enum(LISTING_EVENT_KINDS),
  from_cents: centsNullable.default(null),
  to_cents: centsNullable.default(null),
  note: z.string().nullable().default(null),
});
export type ListingEvent = z.infer<typeof ListingEventSchema>;

export const ProcessedUnitDataSchema = z.object({
  // ---- IDENTITY / SOURCE / DEDUP -------------------------------------
  source_id: z
    .string()
    .regex(/^[a-z0-9_-]+___[A-Za-z0-9_-]+$/, "expected {platform}___{external_id}"),
  platform: z.enum(["rentcafe", "appfolio", "entrata", "spherexx", "seed"]),
  original_source_id: z.string().nullable().default(null), // cross-syndication origin
  collapse_key: z.string(),            // strict dedup: same unit, same source-of-truth
  liberal_dedup_cluster: z.string(),   // loose dedup: same physical unit across sources
  source_url: z.string().url(),
  data_provenance: z.enum(["seed", "scraped"]),
  scraped_at: z.string().datetime(),

  // ---- PROPERTY ENRICHMENT -------------------------------------------
  property_name: z.string(),
  management_company: z.string().nullable().default(null),
  is_management_company_not_mentioned: nm.default(true),
  owner_portfolio: z.string().nullable().default(null),
  is_owner_portfolio_not_mentioned: nm.default(true),
  year_built: z.number().int().min(1880).max(2030).nullable().default(null),
  is_year_built_not_mentioned: nm.default(true),
  property_unit_count: z.number().int().positive().nullable().default(null),
  is_property_unit_count_not_mentioned: nm.default(true),

  // ---- GEO ------------------------------------------------------------
  address_line1: z.string(),
  city: z.string(),
  state: z.string().length(2),
  zip: z.string(),
  neighborhood: z.string(),
  county: z.string().default("Orange"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),

  // ---- UNIT / CONDITIONS ----------------------------------------------
  unit_number: z.string().nullable().default(null),
  floorplan_name: z.string().nullable().default(null),
  beds: z.number().int().min(0).max(6),
  baths: z.number().min(1).max(6),
  sqft: z.number().int().positive().nullable().default(null),
  is_sqft_not_mentioned: nm.default(false),
  floor_level: z.number().int().min(1).max(60).nullable().default(null),
  is_floor_level_not_mentioned: nm.default(true),
  facing_orientation: z.enum(["north", "south", "east", "west", "courtyard", "street", "not_mentioned"]).default("not_mentioned"),
  is_renovated: z.boolean().nullable().default(null),
  is_renovated_not_mentioned: nm.default(true),

  // ---- PRICE ----------------------------------------------------------
  advertised_rent_cents: centsNullable, // null = "call for pricing"
  is_rent_not_mentioned: nm.default(false),
  price_level: z.enum(["unit", "floorplan_starting_at", "not_listed"]),
  is_price_transparent: z.boolean(), // true only when price_level === "unit"
  rent_monthly_cents: centsNullable.default(null),
  rent_weekly_cents: centsNullable.default(null),   // monthly * 12/52
  rent_daily_cents: centsNullable.default(null),    // monthly * 12/365
  rent_annual_cents: centsNullable.default(null),   // monthly * 12
  net_effective_monthly_cents: centsNullable.default(null),

  // ---- CONCESSIONS ----------------------------------------------------
  concession_type: z.enum(["none", "free_weeks", "free_months", "flat_discount", "waived_fees", "gift_card", "other", "not_mentioned"]).default("not_mentioned"),
  concession_free_weeks: z.number().min(0).nullable().default(null),
  concession_free_months: z.number().min(0).nullable().default(null),
  concession_value_cents: centsNullable.default(null),
  concession_applies_lease_months: z.number().int().positive().nullable().default(null),
  concession_text_raw: z.string().nullable().default(null),

  // ---- FEES / DEPOSITS (first-class, not afterthoughts) ---------------
  application_fee_cents: centsNullable.default(null),
  is_application_fee_not_mentioned: nm.default(true),
  admin_fee_cents: centsNullable.default(null),
  is_admin_fee_not_mentioned: nm.default(true),
  security_deposit_cents: centsNullable.default(null),
  is_security_deposit_not_mentioned: nm.default(true),
  security_deposit_refundable: z.boolean().nullable().default(null),
  pet_deposit_cents: centsNullable.default(null),
  pet_rent_monthly_cents: centsNullable.default(null),
  parking_fee_monthly_cents: centsNullable.default(null),
  is_parking_fee_not_mentioned: nm.default(true),
  amenity_fee_cents: centsNullable.default(null),
  tech_package_fee_monthly_cents: centsNullable.default(null),
  trash_valet_fee_monthly_cents: centsNullable.default(null),

  // ---- POLICIES -------------------------------------------------------
  pets_allowed: z.enum(["allowed", "cats_only", "dogs_only", "not_allowed", "not_mentioned"]).default("not_mentioned"),
  pet_weight_limit_lbs: z.number().positive().nullable().default(null),
  pet_count_limit: z.number().int().positive().nullable().default(null),
  lease_term_min_months: z.number().int().positive().nullable().default(null),
  is_lease_term_not_mentioned: nm.default(true),
  lease_term_max_months: z.number().int().positive().nullable().default(null),
  short_term_ok: z.boolean().nullable().default(null),
  furnished: z.enum(["furnished", "unfurnished", "optional", "not_mentioned"]).default("not_mentioned"),
  income_requirement_multiple: z.number().positive().nullable().default(null),
  is_income_requirement_not_mentioned: nm.default(true),
  age_restriction: z.enum(["none", "55_plus", "62_plus", "student", "not_mentioned"]).default("not_mentioned"),
  smoking_allowed: z.boolean().nullable().default(null),
  is_smoking_policy_not_mentioned: nm.default(true),

  // ---- AMENITIES (enum-constrained) -----------------------------------
  unit_amenities: z.array(z.enum(UNIT_AMENITIES)).default([]),
  community_amenities: z.array(z.enum(COMMUNITY_AMENITIES)).default([]),
  is_amenities_not_mentioned: nm.default(false),

  // ---- AVAILABILITY / FRESHNESS ---------------------------------------
  listing_status: z.enum(["active", "stale", "gone"]).default("active"),
  available_on: z.string().date().nullable().default(null),
  is_available_now: z.boolean().default(false),
  first_seen_at: z.string().datetime(),
  last_confirmed_at: z.string().datetime(),
  estimated_publish_date: z.string().date().nullable().default(null), // defeats repost-gaming
  days_on_market: z.number().int().nonnegative().nullable().default(null),

  // ---- DEMAND SIGNALS (reserved; null until real traffic) -------------
  num_views: z.number().int().nonnegative().nullable().default(null),
  num_saves: z.number().int().nonnegative().nullable().default(null),

  // ---- MANAGEMENT SIGNALS (reserved; null until real renter traffic) ----
  // The landlord-facing analog of the outcome signals job aggregators
  // compute for employers.
  management_signals: z
    .object({
      maintenance_responsive: z.boolean().nullable().default(null),
      deposit_fairness: z.boolean().nullable().default(null),
      renewal_pressure: z.boolean().nullable().default(null),
      updated_at: z.string().datetime().nullable().default(null),
    })
    .nullable()
    .default(null),

  // ---- MEDIA ----------------------------------------------------------
  // Floorplan photo/render or layout diagram, hotlinked from the source
  // (never rehosted). Property gallery photos are a separate future field.
  // http(s) only: this value lands in an <img src> sink, and z.string().url()
  // alone accepts javascript:/data: schemes.
  image_url: z
    .string()
    .url()
    .refine((u) => /^https?:/i.test(u), "image_url must be http(s)")
    .nullable()
    .default(null),

  // ---- GENERATED ------------------------------------------------------
  generated_summary: z.string().nullable().default(null),
  events: z.array(ListingEventSchema).default([]),
});

export type ProcessedUnitData = z.infer<typeof ProcessedUnitDataSchema>;

/** Smallest valid record — the base tests and the seed builder both start here. */
export function minimalUnit(): ProcessedUnitData {
  const now = "2026-08-27T12:00:00.000Z";
  return ProcessedUnitDataSchema.parse({
    source_id: `seed${SOURCE_ID_SEPARATOR}u0001`,
    platform: "seed",
    collapse_key: "seed:u0001",
    liberal_dedup_cluster: "orlando:412-e-ridgewood:1br",
    source_url: "https://example.com/seed/u0001",
    data_provenance: "seed",
    scraped_at: now,
    property_name: "Seed Property",
    address_line1: "412 E Ridgewood St",
    city: "Orlando",
    state: "FL",
    zip: "32801",
    neighborhood: "Lake Eola Heights",
    latitude: 28.545,
    longitude: -81.376,
    beds: 1,
    baths: 1,
    advertised_rent_cents: 189500,
    price_level: "unit",
    is_price_transparent: true,
    first_seen_at: now,
    last_confirmed_at: now,
  });
}
