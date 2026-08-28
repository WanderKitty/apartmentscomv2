import type { Listing, UiListingEvent as UiEvent, TrueCost } from "./types";
import {
  ProcessedUnitDataSchema,
  SOURCE_ID_SEPARATOR,
  minimalUnit,
  type ListingEvent,
  type ProcessedUnitData,
} from "./processed-unit-data";
import { netEffectiveMonthlyCents } from "./net-effective";

const DAY = 86_400_000;
const iso = (now: Date, daysAgo: number) => new Date(now.getTime() - daysAgo * DAY).toISOString();
const isoDate = (now: Date, daysFromNow: number) => new Date(now.getTime() + daysFromNow * DAY).toISOString().slice(0, 10);

function withFreqs(u: ProcessedUnitData): ProcessedUnitData {
  const m = u.advertised_rent_cents;
  if (m === null) return u;
  return {
    ...u,
    rent_monthly_cents: m,
    rent_annual_cents: m * 12,
    rent_weekly_cents: Math.round((m * 12) / 52),
    rent_daily_cents: Math.round((m * 12) / 365),
  };
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function seedUnit(n: number, over: Partial<ProcessedUnitData>): ProcessedUnitData {
  const id = `u${String(n).padStart(4, "0")}`;
  const base = minimalUnit();
  const merged: ProcessedUnitData = {
    ...base,
    source_id: `seed${SOURCE_ID_SEPARATOR}${id}`,
    collapse_key: `seed:${id}`,
    source_url: `https://example.com/seed/${id}`,
    ...over,
  };
  // Per-physical-unit dedup cluster unless the override pinned one (B1):
  // every unit must NOT inherit minimalUnit()'s example cluster.
  if (!over.liberal_dedup_cluster) {
    merged.liberal_dedup_cluster = `orlando:${slug(merged.property_name)}-${slug(
      merged.unit_number ?? merged.floorplan_name ?? id,
    )}`;
  }
  return ProcessedUnitDataSchema.parse(withFreqs(merged));
}

/** Neighborhood centroids (approx) so geo stays plausible. */
export const GEO: Record<string, [number, number]> = {
  "Lake Eola Heights": [28.5479, -81.3722], "Thornton Park": [28.5416, -81.3695],
  "Downtown Orlando": [28.5421, -81.379], "Mills 50": [28.5533, -81.3645],
  "College Park": [28.5702, -81.3937], "Baldwin Park": [28.5691, -81.3287],
  SoDo: [28.5203, -81.3781], "Audubon Park": [28.5738, -81.3435],
};

/** One fictional street per neighborhood, for the V-table's derived addresses. */
const STREETS: Record<string, string> = {
  "Lake Eola Heights": "E Robinson St", "Thornton Park": "S Summerlin Ave",
  "Downtown Orlando": "N Orange Ave", "Mills 50": "N Mills Ave",
  "College Park": "Edgewater Dr", "Baldwin Park": "Lake Baldwin Ln",
  SoDo: "S Orange Ave", "Audubon Park": "Corrine Dr",
};

/** Plausible per-neighborhood Orlando zip codes. */
const ZIPS: Record<string, string> = {
  "Lake Eola Heights": "32801", "Thornton Park": "32801", "Downtown Orlando": "32801",
  "Mills 50": "32803", "Audubon Park": "32803",
  "College Park": "32804",
  SoDo: "32806",
  "Baldwin Park": "32814",
};

export function buildSeedUnits(now: Date): ProcessedUnitData[] {
  const units: ProcessedUnitData[] = [];

  // ---- Exemplar 1: the concession-math showcase (6 wk free / 13 mo) ----
  {
    const advertised = 189500;
    const lease = 13;
    units.push(
      seedUnit(1, {
        property_name: "The Camellia at Lake Eola",
        management_company: "Beacon Residential (fictional)",
        is_management_company_not_mentioned: false,
        year_built: 2019, is_year_built_not_mentioned: false,
        property_unit_count: 212, is_property_unit_count_not_mentioned: false,
        neighborhood: "Lake Eola Heights",
        address_line1: "521 E Central Blvd", zip: "32801",
        latitude: GEO["Lake Eola Heights"]![0], longitude: GEO["Lake Eola Heights"]![1],
        unit_number: "304", floorplan_name: "A2", beds: 1, baths: 1, sqft: 742,
        floor_level: 3, is_floor_level_not_mentioned: false,
        advertised_rent_cents: advertised, price_level: "unit", is_price_transparent: true,
        concession_type: "free_weeks", concession_free_weeks: 6,
        concession_applies_lease_months: lease,
        concession_text_raw: "6 weeks free on 13-month leases",
        net_effective_monthly_cents: netEffectiveMonthlyCents({
          advertisedCents: advertised,
          concession: { kind: "free_weeks", weeks: 6, leaseMonths: lease },
        }),
        application_fee_cents: 7500, is_application_fee_not_mentioned: false,
        admin_fee_cents: 25000, is_admin_fee_not_mentioned: false,
        security_deposit_cents: 50000, is_security_deposit_not_mentioned: false,
        security_deposit_refundable: true,
        pets_allowed: "allowed", pet_weight_limit_lbs: 60, pet_count_limit: 2,
        pet_deposit_cents: 30000, pet_rent_monthly_cents: 2500,
        lease_term_min_months: 7, lease_term_max_months: 15, is_lease_term_not_mentioned: false,
        furnished: "unfurnished", short_term_ok: false,
        unit_amenities: ["in-unit laundry", "dishwasher", "balcony", "central air"],
        community_amenities: ["pool", "gym", "pet friendly", "parking"],
        available_on: isoDate(now, 12),
        first_seen_at: iso(now, 47), last_confirmed_at: iso(now, 0.25),
        estimated_publish_date: iso(now, 47).slice(0, 10),
        days_on_market: 47,
        generated_summary:
          "1-bed with in-unit laundry a block from Lake Eola; 6 weeks free works out to $1,693/mo effective on a 13-month lease.",
        events: [
          ev(now, 47, "first_listed", null, 204500),
          ev(now, 6, "price_drop", 204500, advertised, "listed price dropped $150"),
          ev(now, 3, "concession_added", null, null, "6 weeks free on 13-month leases"),
          ev(now, 0.25, "confirmed", null, null),
        ],
      }),
    );
  }

  // ---- Exemplar 2: pet-friendly 2br under $2,400 with laundry (the demo-query winner)
  units.push(
    seedUnit(2, {
      property_name: "Eola Commons",
      neighborhood: "Lake Eola Heights",
      address_line1: "233 N Eola Dr", zip: "32801",
      latitude: 28.5462, longitude: -81.3708,
      unit_number: "812", floorplan_name: "B1", beds: 2, baths: 2, sqft: 1085,
      advertised_rent_cents: 231500, price_level: "unit", is_price_transparent: true,
      concession_type: "none", // source states no specials — "none", not "not_mentioned"
      pets_allowed: "allowed", pet_rent_monthly_cents: 3500, pet_deposit_cents: 25000,
      unit_amenities: ["in-unit laundry", "walk-in closet", "stainless appliances"],
      community_amenities: ["pet friendly", "dog park", "gym", "package lockers"],
      lease_term_min_months: 12, is_lease_term_not_mentioned: false,
      furnished: "unfurnished",
      application_fee_cents: 8500, is_application_fee_not_mentioned: false,
      admin_fee_cents: 20000, is_admin_fee_not_mentioned: false,
      available_on: isoDate(now, 5), is_available_now: false,
      first_seen_at: iso(now, 21), last_confirmed_at: iso(now, 0.5),
      estimated_publish_date: iso(now, 21).slice(0, 10), days_on_market: 21,
      generated_summary:
        "Pet-friendly 2/2 with in-unit laundry near Lake Eola; transparent unit pricing, $2,315 with no current concessions.",
      events: [ev(now, 21, "first_listed", null, 231500), ev(now, 0.5, "confirmed", null, null)],
    }),
  );

  // ---- Exemplar 3: "starting at" floorplan teaser + 1 month free (price-history case)
  {
    const advertised = 174900;
    units.push(
      seedUnit(3, {
        property_name: "The Foundry SoDo",
        neighborhood: "SoDo",
        address_line1: "88 W Grant St", zip: "32806",
        latitude: GEO.SoDo![0], longitude: GEO.SoDo![1],
        unit_number: null, floorplan_name: "S1 Studio", beds: 0, baths: 1, sqft: 528,
        advertised_rent_cents: advertised, price_level: "floorplan_starting_at",
        is_price_transparent: false,
        concession_type: "free_months", concession_free_months: 1,
        concession_applies_lease_months: 12,
        concession_text_raw: "One month free — move in by 9/15!",
        net_effective_monthly_cents: netEffectiveMonthlyCents({
          advertisedCents: advertised,
          concession: { kind: "free_months", months: 1, leaseMonths: 12 },
        }),
        pets_allowed: "cats_only",
        unit_amenities: ["central air"],
        community_amenities: ["pool", "gated"],
        available_on: isoDate(now, 0), is_available_now: true,
        first_seen_at: iso(now, 63), last_confirmed_at: iso(now, 1.2),
        estimated_publish_date: iso(now, 63).slice(0, 10), days_on_market: 63,
        generated_summary:
          "Studio advertised “from $1,749” (floorplan-level teaser); with one month free the effective rate is $1,603/mo on 12 months.",
        events: [
          ev(now, 63, "first_listed", null, 182900),
          ev(now, 30, "price_drop", 182900, 179900),
          ev(now, 11, "price_drop", 179900, advertised, "second cut in a month"),
          ev(now, 9, "concession_added", null, null, "one month free"),
          ev(now, 1.2, "confirmed", null, null),
        ],
      }),
    );
  }

  // ---- Exemplar 4: price NOT listed ("call for pricing") — ranks last, honest badge
  units.push(
    seedUnit(4, {
      property_name: "Baldwin Harbor Flats",
      neighborhood: "Baldwin Park",
      address_line1: "4650 New Broad St", zip: "32814",
      latitude: GEO["Baldwin Park"]![0], longitude: GEO["Baldwin Park"]![1],
      floorplan_name: "C3", beds: 3, baths: 2, sqft: 1410,
      advertised_rent_cents: null, is_rent_not_mentioned: true,
      price_level: "not_listed", is_price_transparent: false,
      concession_type: "none", // review ruling A4: explicit none everywhere there truly is none
      pets_allowed: "not_mentioned",
      community_amenities: ["pool", "playground", "parking"],
      first_seen_at: iso(now, 9), last_confirmed_at: iso(now, 2),
      estimated_publish_date: iso(now, 9).slice(0, 10), days_on_market: 9,
      generated_summary: "3-bed in Baldwin Park; price not published by the source — shown last, never guessed.",
      events: [ev(now, 9, "first_listed", null, null), ev(now, 2, "confirmed", null, null)],
    }),
  );

  // ---- 20 varied units from a fixed table --------------------------------
  const V: Array<[string, string, number, number, number | null, number, number, string[], string[], number, number]> = [
    // property, neighborhood, beds, baths, sqft, advertisedCents, daysListed, unitAmen, commAmen, availDays, confirmedHoursAgo
    ["Mills Row Lofts", "Mills 50", 1, 1, 700, 168000, 14, ["hardwood floors"], ["gym", "parking"], 7, 6],
    ["Mills Row Lofts", "Mills 50", 2, 2, 1010, 214000, 14, ["in-unit laundry"], ["gym", "parking", "pet friendly"], 14, 6],
    ["Thornton Yard", "Thornton Park", 1, 1, 655, 179500, 33, ["balcony"], ["pool", "pet friendly"], 3, 18],
    ["Thornton Yard", "Thornton Park", 2, 1, 940, 226900, 33, ["in-unit laundry", "balcony"], ["pool", "pet friendly"], 21, 18],
    ["College Park Commons", "College Park", 0, 1, 480, 141900, 8, ["central air"], ["parking"], 0, 3],
    ["College Park Commons", "College Park", 1, 1, 690, 163500, 8, ["dishwasher"], ["parking", "pool"], 10, 3],
    ["Audubon Green", "Audubon Park", 2, 2, 1120, 219000, 51, ["in-unit laundry", "walk-in closet"], ["dog park", "pet friendly"], 5, 12],
    ["Audubon Green", "Audubon Park", 1, 1, 730, 172500, 51, ["in-unit laundry"], ["dog park", "pet friendly"], 30, 12],
    ["The Vue Downtown", "Downtown Orlando", 1, 1, 760, 198000, 27, ["stainless appliances", "smart lock"], ["rooftop", "gym", "coworking"], 12, 4],
    ["The Vue Downtown", "Downtown Orlando", 2, 2, 1150, 265000, 27, ["in-unit laundry", "stainless appliances"], ["rooftop", "gym", "coworking"], 18, 4],
    ["The Vue Downtown", "Downtown Orlando", 0, 1, 512, 166000, 27, ["smart lock"], ["rooftop", "gym"], 2, 4],
    ["SoDo Standard", "SoDo", 2, 2, 1060, 208500, 40, ["in-unit laundry", "ceiling fans"], ["pool", "ev charging", "pet friendly"], 9, 30],
    ["SoDo Standard", "SoDo", 1, 1, 685, 167900, 40, ["ceiling fans"], ["pool", "ev charging"], 16, 30],
    ["Baldwin Mews", "Baldwin Park", 2, 2, 1180, 234500, 19, ["in-unit laundry", "walk-in closet"], ["playground", "pet friendly", "garage"], 25, 8],
    ["Baldwin Mews", "Baldwin Park", 1, 1, 725, 186000, 19, ["in-unit laundry"], ["playground", "garage"], 6, 8],
    ["Eola North", "Lake Eola Heights", 2, 2, 1005, 238500, 36, ["in-unit laundry", "balcony"], ["pet friendly", "gym"], 11, 9],
    ["Eola North", "Lake Eola Heights", 0, 1, 495, 152500, 36, ["central air"], ["gym"], 4, 9],
    ["Mills Fifty Flats", "Mills 50", 3, 2, 1320, 259000, 64, ["in-unit laundry", "dishwasher"], ["parking", "pet friendly"], 40, 22],
    ["Thornton Place", "Thornton Park", 0, 1, 465, 148000, 12, ["hardwood floors"], ["gated"], 1, 5],
    ["College Park Row", "College Park", 2, 2, 1090, 205500, 45, ["in-unit laundry", "washer-dryer hookups"], ["pool", "pet friendly", "parking"], 13, 15],
  ];

  V.forEach(([name, hood, beds, baths, sqft, rent, daysListed, ua, ca, avail, confHrs], i) => {
    const n = i + 5;
    const [lat, lng] = GEO[hood]!;
    const events: ListingEvent[] = [ev(now, daysListed, "first_listed", null, rent)];
    // deterministic price-history spice: every 5th varied unit gets a drop
    if (i % 5 === 4) {
      const prior = rent + 12000;
      events[0] = ev(now, daysListed, "first_listed", null, prior);
      events.push(ev(now, Math.max(2, Math.floor(daysListed / 3)), "price_drop", prior, rent));
    }
    events.push(ev(now, confHrs / 24, "confirmed", null, null));
    // Deterministic concessions on two fixed rows (review ruling A3):
    // i===2 → 4 weeks free / 12 mo; i===12 → $1,000 flat discount / 12 mo.
    const concession =
      i === 2
        ? {
            concession_type: "free_weeks" as const,
            concession_free_weeks: 4,
            concession_applies_lease_months: 12,
            concession_text_raw: "4 weeks free on 12-month leases",
            net_effective_monthly_cents: netEffectiveMonthlyCents({
              advertisedCents: rent,
              concession: { kind: "free_weeks", weeks: 4, leaseMonths: 12 },
            }),
          }
        : i === 12
          ? {
              concession_type: "flat_discount" as const,
              concession_value_cents: 100000,
              concession_applies_lease_months: 12,
              concession_text_raw: "$1,000 off — limited time",
              net_effective_monthly_cents: netEffectiveMonthlyCents({
                advertisedCents: rent,
                concession: { kind: "flat_discount", valueCents: 100000, leaseMonths: 12 },
              }),
            }
          : null;
    if (concession) {
      events.push(ev(now, 7, "concession_added", null, null, concession.concession_text_raw));
    }
    units.push(
      seedUnit(n, {
        ...(concession ?? { concession_type: "none" as const }), // A4: explicit none where truly none
        property_name: name, neighborhood: hood, latitude: lat, longitude: lng,
        address_line1: `${120 + i * 31} ${STREETS[hood]}`, zip: ZIPS[hood],
        beds, baths, sqft, is_sqft_not_mentioned: sqft === null,
        floorplan_name: `${"SABC"[beds]}${(i % 3) + 1}`,
        advertised_rent_cents: rent, price_level: "unit", is_price_transparent: true,
        pets_allowed: ca.includes("pet friendly") ? "allowed" : "not_mentioned",
        unit_amenities: ua as ProcessedUnitData["unit_amenities"],
        community_amenities: ca as ProcessedUnitData["community_amenities"],
        available_on: isoDate(now, avail), is_available_now: avail === 0,
        first_seen_at: iso(now, daysListed), last_confirmed_at: iso(now, confHrs / 24),
        estimated_publish_date: iso(now, daysListed).slice(0, 10),
        days_on_market: daysListed,
        events,
      }),
    );
  });

  // ---- B1: deliberate cross-platform duplicate — same physical unit, two sources.
  // SAME liberal_dedup_cluster, DIFFERENT collapse_key; provenance stays "seed"
  // (platform and provenance are separate schema fields for exactly this).
  const ridgewoodCluster = "orlando:412-e-ridgewood-st-402";
  units.push(
    seedUnit(25, {
      source_id: `rentcafe${SOURCE_ID_SEPARATOR}ridgewood-402`,
      platform: "rentcafe",
      collapse_key: "rentcafe:ridgewood-402",
      liberal_dedup_cluster: ridgewoodCluster,
      property_name: "Ridgewood House",
      unit_number: "402", floorplan_name: "A1", beds: 1, baths: 1, sqft: 705,
      advertised_rent_cents: 184500, price_level: "unit", is_price_transparent: true,
      concession_type: "none",
      first_seen_at: iso(now, 18), last_confirmed_at: iso(now, 1),
      estimated_publish_date: iso(now, 18).slice(0, 10), days_on_market: 18,
      events: [ev(now, 18, "first_listed", null, 184500), ev(now, 1, "confirmed")],
    }),
    seedUnit(26, {
      source_id: `appfolio${SOURCE_ID_SEPARATOR}ridgewood-402`,
      platform: "appfolio",
      collapse_key: "appfolio:ridgewood-402",
      liberal_dedup_cluster: ridgewoodCluster,
      property_name: "Ridgewood House",
      unit_number: "402", floorplan_name: "A1", beds: 1, baths: 1, sqft: 705,
      advertised_rent_cents: 177500, price_level: "unit", is_price_transparent: true,
      concession_type: "none",
      first_seen_at: iso(now, 6), last_confirmed_at: iso(now, 0.5), // fresher source
      estimated_publish_date: iso(now, 6).slice(0, 10), days_on_market: 6,
      events: [ev(now, 6, "first_listed", null, 177500), ev(now, 0.5, "confirmed")],
    }),
  );

  return units;
}

function ev(now: Date, daysAgo: number, kind: ListingEvent["kind"], from: number | null = null, to: number | null = null, note: string | null = null): ListingEvent {
  return { at: iso(now, daysAgo), kind, from_cents: from, to_cents: to, note };
}

// ---- Projection to the UI type -----------------------------------------

const d = (c: number) => Math.round(c / 100);

function trueCostOf(u: ProcessedUnitData): TrueCost | null {
  if (u.advertised_rent_cents === null) return null;
  const fees: TrueCost["moveInFees"] = [];
  if (u.application_fee_cents) fees.push({ label: "Application fee", amount: d(u.application_fee_cents) });
  if (u.admin_fee_cents) fees.push({ label: "Admin fee", amount: d(u.admin_fee_cents) });
  if (u.security_deposit_cents) fees.push({ label: `Security deposit${u.security_deposit_refundable ? " (refundable)" : ""}`, amount: d(u.security_deposit_cents) });
  if (u.pet_deposit_cents) fees.push({ label: "Pet deposit", amount: d(u.pet_deposit_cents) });
  const net = u.net_effective_monthly_cents ?? u.advertised_rent_cents;
  const lease = u.concession_applies_lease_months;
  const label =
    u.concession_type === "free_weeks" && lease ? `${u.concession_free_weeks} wk free ÷ ${lease} mo`
    : u.concession_type === "free_months" && lease ? `${u.concession_free_months} mo free ÷ ${lease} mo`
    : u.concession_type === "flat_discount" && lease ? `$${d(u.concession_value_cents ?? 0)} off ÷ ${lease} mo`
    : "No concessions";
  const advertisedMonthly = d(u.advertised_rent_cents);
  const concessionMonthly = d(u.advertised_rent_cents - net);
  return {
    advertisedMonthly,
    concessionLabel: label,
    concessionMonthly,
    // Derived after rounding (A10) so displayed arithmetic can never drift $1.
    netEffectiveMonthly: advertisedMonthly - concessionMonthly,
    moveInFees: fees,
  };
}

export function toListing(u: ProcessedUnitData, now: Date): Listing {
  return {
    // Full source_id (e.g. "seed___u0001", "appfolio___ridgewood-402") —
    // globally unique across platforms, unlike the bare external id, which
    // the Ridgewood duplicate pair shares.
    id: u.source_id,
    propertyId: u.collapse_key,
    propertyName: u.property_name,
    neighborhood: u.neighborhood,
    address: `${u.address_line1}, ${u.city}, ${u.state} ${u.zip}`,
    latitude: u.latitude,
    longitude: u.longitude,
    beds: u.beds, baths: u.baths, sqft: u.sqft,
    price: u.advertised_rent_cents === null ? null : d(u.advertised_rent_cents),
    priceIsStartingAt: u.price_level === "floorplan_starting_at",
    concessionsText: u.concession_text_raw,
    netEffectiveRent: u.net_effective_monthly_cents === null ? null : d(u.net_effective_monthly_cents),
    availableDate: u.available_on,
    furnished: u.furnished === "furnished",
    shortTermOk: u.short_term_ok === true,
    status: u.listing_status,
    firstListedAt: u.first_seen_at,
    lastConfirmedAt: u.last_confirmed_at,
    priceHistory: u.events
      .filter((e) => (e.kind === "price_drop" || e.kind === "price_increase") && e.from_cents !== null && e.to_cents !== null)
      .map((e) => ({ at: e.at, from: d(e.from_cents!), to: d(e.to_cents!) })),
    photoUrl: null,
    sourceUrl: u.source_url,
    platform: u.platform,
    amenities: [...u.unit_amenities, ...u.community_amenities],
    description: u.generated_summary,
    score: { textRelevance: 0, freshness: 0, trust: 0, proximity: 0, total: 0 },
    events: u.events.map((e) => ({ at: e.at, kind: e.kind, fromCents: e.from_cents, toCents: e.to_cents, note: e.note })),
    alsoListedOn: [],
    dedupCluster: u.liberal_dedup_cluster,
    trueCost: trueCostOf(u),
    provenance: u.data_provenance,
    daysOnMarket: u.days_on_market ?? Math.max(0, Math.round((now.getTime() - new Date(u.first_seen_at).getTime()) / 86_400_000)),
  };
}
