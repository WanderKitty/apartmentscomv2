# Plan 2: Schema + Seed + Search Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An end-of-day demo on the `web-ui-skeleton` worktree: a ~90-field enum-constrained unit schema (`v1_processed_unit_data`, 92 fields as authored), 24 honestly-labeled seeded Orlando listings with concession math and price history, a real Haiku NL query parser with fail-open ladder, and UI that shows true-cost arithmetic, time badges, parse echo, and search timing.

**Architecture:** All work happens inside the existing Next.js 16 app at `web/` in the worktree `X:\apartmentscomv2\.claude\worktrees\web-ui-skeleton` (branch `worktree-web-ui-skeleton`). The schema is a Zod module; seed data is deterministic TS (defaults + exemplars + a variation table) validated through the schema and projected to the UI's existing `Listing` type; search stays in-memory server-side (SSR page → SearchService), which is the honest, fast demo path — Postgres integration is post-demo. The LLM parse is a server-only module with an in-memory cache and the mock keyword parser as its fallback rung.

**Tech Stack:** Existing worktree stack — Next 16.3.3, React 19.2.8, TypeScript 5, Tailwind 4, Vitest 4, Testing Library, **npm** (not pnpm). New deps in `web/`: `zod`, `@anthropic-ai/sdk`.

**Spec:** `docs/superpowers/specs/2026-08-27-apartment-aggregator-design.md` (§6 search/ranking, §7 compliance) plus the user's revised demo directive (this plan's source of truth where they differ: ingestion demoted, schema depth + search experience is the pitch).

## Global Constraints

- Work directory for every task: `X:\apartmentscomv2\.claude\worktrees\web-ui-skeleton` (commands run in its `web/` folder). Task branches `task/p2-<n>-<slug>` branch off `worktree-web-ui-skeleton` and merge back into it. Master merge happens only at the end, if green.
- **Framing constraints (binding for all user-facing copy, README, comments):** describe competitor findings as "studied public payloads from my own browsing session." Never name or hint at any site's anti-bot measures. Do not claim hiring.cafe's AI search doesn't exist (it exists as a separate tab). Phrase their pipeline as inference ("the schema implies LLM extraction"), not fact.
- No hiring.cafe-derived strings anywhere user-facing, except the deliberate field-name homages: `collapse_key`, `liberal_dedup_cluster`, `original_source_id`.
- Seed data must be clearly labeled as seed in the UI (visible banner) and carry `data_provenance: "seed"` in the schema. Property names/addresses stay fictional; `photo_url` stays null (nothing rehosted).
- The Anthropic API key is server-only: never referenced in client components; parse module is imported only from server code. Model for the parser is `claude-haiku-4-5` (user-specified; deliberate exception to the opus-default rule).
- Next 16 note: `web/AGENTS.md` warns conventions may differ from training data. Before writing/modifying any `app/` route or page, consult `web/node_modules/next/dist/docs/` and follow what it says; the existing `app/page.tsx` (async server component, `PageProps<"/">`, awaited `searchParams`) is the reference pattern.
- Follow the worktree's conventions: `@/` import alias, Tailwind tokens already in use (`text-ink`, `text-muted`, `border-hairline`, `rounded-card`), Vitest 4 + Testing Library for component tests. TDD for all logic modules (schema math, parse, search).
- Prices are integer **cents** in the schema; the UI's existing `Listing.price` stays whole dollars — `toListing()` converts.
- Do not commit `web/AGENTS.md` churn from `next dev` unless it appears; if it does, include it as-is per its own instructions.
- End every commit message with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: `v1_processed_unit_data` schema + net-effective math

**Files:**
- Create: `web/lib/schema/processed-unit-data.ts`, `web/lib/schema/net-effective.ts`
- Create: `web/scripts/gen-schema-docs.ts`, `web/docs/schema.md` (generated)
- Test: `web/lib/schema/net-effective.test.ts`, `web/lib/schema/processed-unit-data.test.ts`
- Modify: `web/package.json` (add `zod`; script `"gen:schema-docs": "npx tsx scripts/gen-schema-docs.ts"`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ProcessedUnitData` (type) + `ProcessedUnitDataSchema` (Zod) + `netEffectiveMonthlyCents(input): number` + `SOURCE_ID_SEPARATOR = "___"`. Task 2 builds seed records against exactly these names.

- [ ] **Step 1: Install zod**

Run in `web/`: `npm install zod`
(If a peer conflict arises with `@anthropic-ai/sdk` later, prefer the zod major that satisfies the SDK's peer range and note it in the report.)

- [ ] **Step 2: Write the failing math test**

`web/lib/schema/net-effective.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { netEffectiveMonthlyCents } from "./net-effective";

describe("netEffectiveMonthlyCents", () => {
  it("spreads free weeks over the lease (6 wk free, $1,895, 13 mo)", () => {
    expect(
      netEffectiveMonthlyCents({
        advertisedCents: 189500,
        concession: { kind: "free_weeks", weeks: 6, leaseMonths: 13 },
      }),
    ).toBe(169317); // 189500 * (1 - (6*12/52)/13)
  });

  it("spreads one month free over 12 months", () => {
    expect(
      netEffectiveMonthlyCents({
        advertisedCents: 200000,
        concession: { kind: "free_months", months: 1, leaseMonths: 12 },
      }),
    ).toBe(183333);
  });

  it("spreads a flat discount over the lease", () => {
    expect(
      netEffectiveMonthlyCents({
        advertisedCents: 189500,
        concession: { kind: "flat_discount", valueCents: 100000, leaseMonths: 12 },
      }),
    ).toBe(181167);
  });

  it("no concession → advertised rent", () => {
    expect(
      netEffectiveMonthlyCents({ advertisedCents: 189500, concession: null }),
    ).toBe(189500);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run in `web/`: `npx vitest run lib/schema/net-effective.test.ts`
Expected: FAIL — cannot find `./net-effective`.

- [ ] **Step 4: Implement the math**

`web/lib/schema/net-effective.ts`:

```ts
// True-cost math. A "week free" is one week of rent forgiven: monthly * 12/52.
// The forgiven total is spread evenly over the lease term.

export type Concession =
  | { kind: "free_weeks"; weeks: number; leaseMonths: number }
  | { kind: "free_months"; months: number; leaseMonths: number }
  | { kind: "flat_discount"; valueCents: number; leaseMonths: number };

export function netEffectiveMonthlyCents(input: {
  advertisedCents: number;
  concession: Concession | null;
}): number {
  const { advertisedCents, concession } = input;
  if (!concession) return advertisedCents;
  let discountTotalCents: number;
  switch (concession.kind) {
    case "free_weeks":
      discountTotalCents = advertisedCents * concession.weeks * (12 / 52);
      break;
    case "free_months":
      discountTotalCents = advertisedCents * concession.months;
      break;
    case "flat_discount":
      discountTotalCents = concession.valueCents;
      break;
  }
  return Math.round(
    advertisedCents - discountTotalCents / concession.leaseMonths,
  );
}
```

- [ ] **Step 5: GREEN, then write the schema test**

Run: `npx vitest run lib/schema/net-effective.test.ts` → 4 passed.

`web/lib/schema/processed-unit-data.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ProcessedUnitDataSchema,
  SOURCE_ID_SEPARATOR,
  minimalUnit,
} from "./processed-unit-data";

describe("ProcessedUnitDataSchema", () => {
  it("accepts a minimal valid record with not_mentioned defaults", () => {
    const parsed = ProcessedUnitDataSchema.parse(minimalUnit());
    expect(parsed.is_year_built_not_mentioned).toBe(true);
    expect(parsed.pets_allowed).toBe("not_mentioned");
    expect(parsed.data_provenance).toBe("seed");
  });

  it("rejects an out-of-enum amenity", () => {
    const bad = { ...minimalUnit(), unit_amenities: ["helipad"] };
    expect(() => ProcessedUnitDataSchema.parse(bad)).toThrow();
  });

  it("rejects a source_id without the platform___external separator", () => {
    const bad = { ...minimalUnit(), source_id: "rentcafe-abc" };
    expect(() => ProcessedUnitDataSchema.parse(bad)).toThrow();
  });

  it("field count is ~90 (92 as authored)", () => {
    const n = Object.keys(ProcessedUnitDataSchema.shape).length;
    expect(n).toBeGreaterThanOrEqual(60);
    // Upper bound guards accidental bloat only — never trim real fields to fit it.
    expect(n).toBeLessThanOrEqual(95);
  });

  it("exposes the source-id separator homage", () => {
    expect(SOURCE_ID_SEPARATOR).toBe("___");
  });
});
```

Run: `npx vitest run lib/schema/processed-unit-data.test.ts` → FAIL (module missing).

- [ ] **Step 6: Implement the schema**

`web/lib/schema/processed-unit-data.ts` — write exactly this (grouped to mirror the demo pitch; every enum-ish extraction gets an explicit `not_mentioned` state, either as an enum member or an `is_X_not_mentioned` boolean companion, so absent ≠ zero/no):

```ts
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
  platform: z.enum(["rentcafe", "appfolio", "entrata", "seed"]),
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
```

- [ ] **Step 7: GREEN + generate docs**

Run: `npx vitest run lib/schema` → all pass. If the field-count assertion fails in either direction, the schema above has drifted from this plan — restore it rather than padding or trimming.

`web/scripts/gen-schema-docs.ts`:

```ts
import { writeFileSync } from "node:fs";
import { z } from "zod";
import { ProcessedUnitDataSchema } from "../lib/schema/processed-unit-data";

const rows = Object.entries(ProcessedUnitDataSchema.shape).map(([name, s]) => {
  let t = s;
  const mods: string[] = [];
  while (t instanceof z.ZodDefault || t instanceof z.ZodNullable) {
    if (t instanceof z.ZodDefault) { mods.push("default"); t = t.def.innerType; }
    else { mods.push("nullable"); t = t.def.innerType; }
  }
  const kind = t.def.type;
  const values = t instanceof z.ZodEnum ? Object.values(t.def.entries).join(" \\| ") : "";
  return `| \`${name}\` | ${kind}${mods.length ? ` (${mods.join(", ")})` : ""} | ${values} |`;
});

writeFileSync(
  "docs/schema.md",
  `# v1_processed_unit_data\n\nGenerated by \`npm run gen:schema-docs\` — do not edit by hand.\n${Object.keys(ProcessedUnitDataSchema.shape).length} fields.\n\n| Field | Type | Enum values |\n|---|---|---|\n${rows.join("\n")}\n`,
);
console.log(`wrote docs/schema.md (${rows.length} fields)`);
```

Run in `web/`: `npm run gen:schema-docs` — expect `wrote docs/schema.md (92 fields)` (60–95 acceptable if the schema legitimately evolves). (Zod v4 introspection API: if `def.type`/`def.entries` differ in the installed version, adapt the script to the version's documented introspection — the doc table is the deliverable, the exact API is not.)

- [ ] **Step 8: Commit**

```bash
git add web/lib/schema web/scripts/gen-schema-docs.ts web/docs/schema.md web/package.json web/package-lock.json
git commit -m "feat: v1_processed_unit_data schema with net-effective math"
```

---

### Task 2: Seed 24 Orlando listings through the schema

**Files:**
- Create: `web/lib/seed.ts`
- Modify: `web/lib/types.ts` (extend `Listing`), `web/lib/fixtures.ts` (re-export seed-derived listings), `web/lib/mock-search.ts` (consume seed listings)
- Test: `web/lib/seed.test.ts`

**Interfaces:**
- Consumes: `ProcessedUnitDataSchema`, `minimalUnit`, `netEffectiveMonthlyCents`, `ListingEvent` from Task 1.
- Produces: `buildSeedUnits(now: Date): ProcessedUnitData[]` (24 records, schema-validated), `toListing(u: ProcessedUnitData, now: Date): Listing`, and `Listing` gains `events: ListingEvent[]`, `trueCost: TrueCost | null`, `provenance: "seed" | "scraped"`, `daysOnMarket: number`. Tasks 4–5 consume these exact names.

- [ ] **Step 1: Extend the UI type**

In `web/lib/types.ts` add above `Listing`:

```ts
export interface TrueCost {
  advertisedMonthly: number;           // dollars
  concessionLabel: string;             // e.g. "6 wk free ÷ 13 mo"
  concessionMonthly: number;           // dollars saved per month (positive)
  netEffectiveMonthly: number;         // dollars
  moveInFees: Array<{ label: string; amount: number }>; // one-time, dollars
}

export interface ListingEvent {
  at: string; // ISO datetime
  kind: "first_listed" | "price_drop" | "price_increase" | "concession_added" | "concession_removed" | "confirmed";
  fromCents: number | null;
  toCents: number | null;
  note: string | null;
}
```

and add to `Listing`: `events: ListingEvent[];`, `trueCost: TrueCost | null;`, `provenance: "seed" | "scraped";`, `daysOnMarket: number;`.

- [ ] **Step 2: Write the failing seed test**

`web/lib/seed.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ProcessedUnitDataSchema } from "./schema/processed-unit-data";
import { buildSeedUnits, toListing } from "./seed";

const NOW = new Date("2026-08-27T12:00:00.000Z");

describe("seed data", () => {
  const units = buildSeedUnits(NOW);

  it("has 24 schema-valid, seed-labeled units with unique ids", () => {
    expect(units).toHaveLength(24);
    for (const u of units) {
      ProcessedUnitDataSchema.parse(u);
      expect(u.data_provenance).toBe("seed");
    }
    expect(new Set(units.map((u) => u.source_id)).size).toBe(24);
  });

  it("has at least 4 units with concession math and correct arithmetic", () => {
    const withConcessions = units.filter(
      (u) => u.concession_type === "free_weeks" || u.concession_type === "free_months" || u.concession_type === "flat_discount",
    );
    expect(withConcessions.length).toBeGreaterThanOrEqual(4);
    for (const u of withConcessions) {
      expect(u.net_effective_monthly_cents).not.toBeNull();
      expect(u.net_effective_monthly_cents!).toBeLessThan(u.advertised_rent_cents!);
    }
  });

  it("has at least 3 units with multi-event price history", () => {
    const withHistory = units.filter(
      (u) => u.events.filter((e) => e.kind === "price_drop" || e.kind === "price_increase").length >= 1 && u.events.length >= 3,
    );
    expect(withHistory.length).toBeGreaterThanOrEqual(3);
  });

  it("projects to the UI Listing type with true-cost and days on market", () => {
    const camellia = units.find((u) => u.property_name.includes("Camellia"))!;
    const l = toListing(camellia, NOW);
    expect(l.provenance).toBe("seed");
    expect(l.trueCost!.netEffectiveMonthly).toBe(Math.round(camellia.net_effective_monthly_cents! / 100));
    expect(l.daysOnMarket).toBeGreaterThan(40); // first_listed 47 days before NOW
    expect(l.events.length).toBeGreaterThanOrEqual(3);
  });

  it("frequency normalization is consistent", () => {
    for (const u of units) {
      if (u.rent_monthly_cents !== null) {
        expect(u.rent_annual_cents).toBe(u.rent_monthly_cents * 12);
        expect(u.rent_weekly_cents).toBe(Math.round((u.rent_monthly_cents * 12) / 52));
      }
    }
  });
});
```

Run: `npx vitest run lib/seed.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the seed builder**

`web/lib/seed.ts` — deterministic: a base from `minimalUnit()`, four hand-authored exemplars, and a variation table for the rest. No randomness, all dates relative to `now`. Write:

```ts
import type { Listing, ListingEvent as UiEvent, TrueCost } from "./types";
import {
  ProcessedUnitDataSchema,
  SOURCE_ID_SEPARATOR,
  minimalUnit,
  type ListingEvent,
  type ProcessedUnitData,
} from "./schema/processed-unit-data";
import { netEffectiveMonthlyCents } from "./schema/net-effective";

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
  return ProcessedUnitDataSchema.parse(withFreqs(merged));
}

/** Neighborhood centroids (approx) so geo stays plausible. */
const GEO: Record<string, [number, number]> = {
  "Lake Eola Heights": [28.5479, -81.3722], "Thornton Park": [28.5416, -81.3695],
  "Downtown Orlando": [28.5421, -81.379], "Mills 50": [28.5533, -81.3645],
  "College Park": [28.5702, -81.3937], "Baldwin Park": [28.5691, -81.3287],
  SoDo: [28.5203, -81.3781], "Audubon Park": [28.5738, -81.3435],
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
        latitude: GEO["Lake Eola Heights"][0], longitude: GEO["Lake Eola Heights"][1],
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
        latitude: GEO.SoDo[0], longitude: GEO.SoDo[1],
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
      latitude: GEO["Baldwin Park"][0], longitude: GEO["Baldwin Park"][1],
      floorplan_name: "C3", beds: 3, baths: 2, sqft: 1410,
      advertised_rent_cents: null, is_rent_not_mentioned: true,
      price_level: "not_listed", is_price_transparent: false,
      // concession_type deliberately stays "not_mentioned": this source publishes
      // nothing, showcasing the none-vs-not_mentioned distinction the schema exists for.
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
    const [lat, lng] = GEO[hood];
    const events: ListingEvent[] = [ev(now, daysListed, "first_listed", null, rent)];
    // deterministic price-history spice: every 5th varied unit gets a drop
    if (i % 5 === 4) {
      const prior = rent + 12000;
      events[0] = ev(now, daysListed, "first_listed", null, prior);
      events.push(ev(now, Math.max(2, Math.floor(daysListed / 3)), "price_drop", prior, rent));
    }
    events.push(ev(now, confHrs / 24, "confirmed", null, null));
    // deterministic concession spice: every 7th varied unit gets 4 weeks free / 12 mo
    const hasConcession = i % 7 === 6;
    if (hasConcession) {
      events.push(ev(now, Math.max(1, Math.floor(daysListed / 4)), "concession_added", null, null, "4 weeks free on 12-month leases"));
    }
    units.push(
      seedUnit(n, {
        ...(hasConcession
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
          : { concession_type: "none" as const }), // fictional sources state "no specials" — explicit none
        property_name: name, neighborhood: hood, latitude: lat, longitude: lng,
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
  return {
    advertisedMonthly: d(u.advertised_rent_cents),
    concessionLabel: label,
    concessionMonthly: d(u.advertised_rent_cents - net),
    netEffectiveMonthly: d(net),
    moveInFees: fees,
  };
}

export function toListing(u: ProcessedUnitData, now: Date): Listing {
  return {
    id: u.source_id.split(SOURCE_ID_SEPARATOR)[1] ?? u.source_id,
    propertyId: u.collapse_key,
    propertyName: u.property_name,
    neighborhood: u.neighborhood,
    address: `${u.address_line1}, ${u.city}, ${u.state} ${u.zip}`,
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
    trueCost: trueCostOf(u),
    provenance: u.data_provenance,
    daysOnMarket: u.days_on_market ?? Math.max(0, Math.round((now.getTime() - new Date(u.first_seen_at).getTime()) / 86_400_000)),
  };
}
```

- [ ] **Step 4: Wire fixtures/mock-search to the seed and go GREEN**

In `web/lib/fixtures.ts`: replace the body of `makeListings(now)` with `return buildSeedUnits(now).map((u) => toListing(u, now));` (import from `./seed`), keeping `NEIGHBORHOOD_ALIASES` / `AMENITY_KEYWORDS` exports (they now also feed the LLM enums). Delete the old hand-written listing array. Update any fixture-dependent tests/usages (`mock-search.ts` consumes `makeListings` unchanged; `SourceHealth` fixtures stay).

Run: `npx vitest run` (whole suite) → seed tests pass; fix any existing component tests that referenced removed fixture literals by pointing them at seed-derived listings.

- [ ] **Step 5: Commit**

```bash
git add web/lib
git commit -m "feat: 24 seeded Orlando listings through v1_processed_unit_data"
```

---

### Task 3: Haiku NL query parse with fail-open ladder

**Files:**
- Create: `web/lib/parse/llm-parse.ts`
- Modify: `web/lib/types.ts` (`ParsedQuery` gains `parseSource`, `parseMs`), `web/lib/mock-search.ts` (`parseQueryMock` sets `parseSource: "fallback"`, `parseMs: 0`)
- Test: `web/lib/parse/llm-parse.test.ts`
- Modify: `web/package.json` (add `@anthropic-ai/sdk`)

**Interfaces:**
- Consumes: `NEIGHBORHOOD_ALIASES`, `AMENITY_KEYWORDS` (enum sources), `parseQueryMock` (fallback rung), `ParsedQuery`.
- Produces: `parseQuery(raw: string): Promise<ParsedQuery>` — server-only; Task 4's SearchService calls exactly this.

- [ ] **Step 1: Install the SDK and extend ParsedQuery**

Run in `web/`: `npm install @anthropic-ai/sdk`

In `web/lib/types.ts`, add to `ParsedQuery`:

```ts
  /** Which rung produced this parse. */
  parseSource: "llm" | "cache" | "fallback";
  /** Wall-clock ms spent parsing (0 on cache hits). */
  parseMs: number;
```

In `web/lib/mock-search.ts`, add `parseSource: "fallback" as const, parseMs: 0` to the object returned by `parseQueryMock`, and fix any type errors this surfaces.

- [ ] **Step 2: Write the failing parse tests**

`web/lib/parse/llm-parse.test.ts` — the Anthropic client is injected so tests never hit the network:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetParseCacheForTests, parseQueryWith } from "./llm-parse";

const LLM_OUT = {
  neighborhoods: ["Lake Eola Heights"],
  price_max_dollars: 2400,
  beds_min: 2,
  furnished: null,
  short_term: null,
  amenities: ["pet friendly", "in-unit laundry"],
  residual_text: "",
};

function fakeClient(parsed: unknown, delayMs = 0) {
  return {
    messages: {
      parse: vi.fn(async () => {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        return { parsed_output: parsed };
      }),
    },
  };
}

beforeEach(() => __resetParseCacheForTests());

describe("parseQueryWith", () => {
  it("maps the demo query's LLM output onto ParsedQuery", async () => {
    const p = await parseQueryWith("pet friendly 2br under $2400 near Lake Eola with in-unit laundry", fakeClient(LLM_OUT) as never);
    expect(p.parseSource).toBe("llm");
    expect(p.neighborhoods).toEqual(["Lake Eola Heights"]);
    expect(p.priceMax).toBe(2400);
    expect(p.bedsMin).toBe(2);
    expect(p.amenities).toEqual(["pet friendly", "in-unit laundry"]);
    expect(p.failedOpen).toBe(false);
  });

  it("serves the second identical query from cache", async () => {
    const client = fakeClient(LLM_OUT);
    await parseQueryWith("2br near lake eola", client as never);
    const second = await parseQueryWith("  2BR   near Lake Eola ", client as never); // normalization collapses these
    expect(second.parseSource).toBe("cache");
    expect(client.messages.parse).toHaveBeenCalledTimes(1);
  });

  it("falls open to the keyword parser when the LLM returns null", async () => {
    const p = await parseQueryWith("2br in baldwin park", fakeClient(null) as never);
    expect(p.parseSource).toBe("fallback");
    expect(p.bedsMin).toBe(2); // keyword rung still extracted it
  });

  it("falls open on timeout without throwing", async () => {
    const p = await parseQueryWith("studio downtown", fakeClient(LLM_OUT, 5000) as never, { timeoutMs: 50 });
    expect(p.parseSource).toBe("fallback");
  });

  it("falls open when no client can be constructed (no API key)", async () => {
    const p = await parseQueryWith("1br mills 50", null, {});
    expect(p.parseSource).toBe("fallback");
  });
});
```

Run: `npx vitest run lib/parse` → FAIL (module missing).

- [ ] **Step 3: Implement the parser**

`web/lib/parse/llm-parse.ts` (server-only — imported by SearchService, never by client components):

```ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AMENITY_KEYWORDS, NEIGHBORHOOD_ALIASES } from "../fixtures";
import { parseQueryMock } from "../mock-search";
import type { ParsedQuery } from "../types";

const NEIGHBORHOODS = Object.keys(NEIGHBORHOOD_ALIASES) as [string, ...string[]];
const AMENITIES = Object.keys(AMENITY_KEYWORDS) as [string, ...string[]];

const LlmParseSchema = z.object({
  neighborhoods: z.array(z.enum(NEIGHBORHOODS)),
  price_max_dollars: z.number().int().positive().nullable(),
  beds_min: z.number().int().min(0).max(6).nullable(),
  furnished: z.boolean().nullable(),
  short_term: z.boolean().nullable(),
  amenities: z.array(z.enum(AMENITIES)),
  residual_text: z.string(),
});

const SYSTEM = `You convert one apartment-search query into filters. Extract ONLY constraints the user actually stated; use null for anything not stated. Neighborhoods must come from this exact list (map colloquial names onto them, e.g. "near lake eola" → "Lake Eola Heights"): ${NEIGHBORHOODS.join("; ")}. Amenities must come from this exact list: ${AMENITIES.join("; ")}. "2br"/"two bed" → beds_min 2; "studio" → beds_min 0. Put any leftover free text that expresses a real constraint you could not map into residual_text, else "".`;

// Spec §6.1 budgets 800ms; the demo uses a looser 2500ms so a cold Haiku
// round-trip lands as "llm" rather than falling open mid-demo.
const DEFAULT_TIMEOUT_MS = 2500;

const cache = new Map<string, ParsedQuery>();
export function __resetParseCacheForTests(): void {
  cache.clear();
}

const normalize = (raw: string) => raw.toLowerCase().replace(/\s+/g, " ").trim();

type ParseClient = Pick<Anthropic, "messages"> | null;

let defaultClient: ParseClient | undefined;
function getClient(): ParseClient {
  if (defaultClient !== undefined) return defaultClient;
  try {
    defaultClient = new Anthropic(); // resolves ANTHROPIC_API_KEY / ant profile
  } catch {
    defaultClient = null; // no credentials → permanent fallback, never an error
  }
  return defaultClient;
}

export async function parseQueryWith(
  raw: string,
  client: ParseClient,
  opts: { timeoutMs?: number } = {},
): Promise<ParsedQuery> {
  const key = normalize(raw);
  const hit = cache.get(key);
  if (hit) return { ...hit, parseSource: "cache", parseMs: 0 };

  const fallback = (): ParsedQuery => parseQueryMock(raw);
  if (!client) return fallback();

  const started = performance.now();
  try {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const response = await Promise.race([
      client.messages.parse({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: "user", content: raw }],
        output_config: { format: zodOutputFormat(LlmParseSchema) },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("parse-timeout")), timeoutMs),
      ),
    ]);
    const out = response.parsed_output;
    if (!out) return fallback();
    const parsed: ParsedQuery = {
      neighborhoods: out.neighborhoods,
      priceMax: out.price_max_dollars,
      bedsMin: out.beds_min,
      furnished: out.furnished,
      shortTerm: out.short_term,
      amenities: out.amenities,
      residualText: out.residual_text,
      failedOpen: false,
      parseSource: "llm",
      parseMs: Math.round(performance.now() - started),
    };
    cache.set(key, parsed);
    return parsed;
  } catch {
    return fallback(); // timeout, network, refusal, anything → keyword rung
  }
}

/** Production entrypoint: real client, default budget. */
export function parseQuery(raw: string): Promise<ParsedQuery> {
  return parseQueryWith(raw, getClient());
}
```

(If `server-only` isn't already a dependency in this Next 16 app, `npm install server-only`. If Vitest chokes on that import in unit tests, mock it in `web/vitest.setup.ts` with `vi.mock("server-only", () => ({}))`.)

- [ ] **Step 4: GREEN + whole suite**

Run: `npx vitest run lib/parse` → 5 passed. Then `npx vitest run` → everything green, `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add web/lib web/package.json web/package-lock.json web/vitest.setup.ts
git commit -m "feat: haiku query parse with cache and fail-open ladder"
```

---

### Task 4: Real SearchService with ranking and timing

**Files:**
- Create: `web/lib/search.ts`
- Modify: `web/lib/types.ts` (`SearchResult` gains `timing`), `web/app/page.tsx` + `web/app/listing/[id]/page.tsx` + `web/app/admin/page.tsx` (swap `searchService` import from `@/lib/mock-search` to `@/lib/search`)
- Test: `web/lib/search.test.ts`

**Interfaces:**
- Consumes: `parseQuery` (Task 3), `buildSeedUnits`/`toListing` (Task 2), `matches`-style filtering and scoring per the existing mock (reuse its logic, upgraded).
- Produces: `searchService: SearchService` where `SearchResult` now includes `timing: { parseMs: number; searchMs: number; p50SearchMs: number; corpus: number }`. Task 5 renders it.

- [ ] **Step 1: Extend SearchResult**

In `web/lib/types.ts` add to `SearchResult`:

```ts
  timing: {
    parseMs: number;
    searchMs: number;
    p50SearchMs: number;
    corpus: number; // number of seeded listings searched
  };
```

Give `mock-search.ts`'s result object a `timing: { parseMs: 0, searchMs: 0, p50SearchMs: 0, corpus: listings.length }` so it still typechecks.

- [ ] **Step 2: Write the failing search tests**

`web/lib/search.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("./parse/llm-parse", async () => {
  const { parseQueryMock } = await import("./mock-search");
  return { parseQuery: async (raw: string) => parseQueryMock(raw) };
});

import { searchService } from "./search";

describe("searchService", () => {
  it("the demo query returns only matching listings, best first", async () => {
    const r = await searchService.search("pet friendly 2br under $2400 near Lake Eola with in-unit laundry");
    expect(r.listings.length).toBeGreaterThanOrEqual(1);
    for (const l of r.listings.filter((x) => x.price !== null)) {
      expect(l.price!).toBeLessThanOrEqual(2400);
      expect(l.beds).toBeGreaterThanOrEqual(2);
      expect(l.neighborhood).toBe("Lake Eola Heights");
    }
    expect(r.listings[0].propertyName).toBe("Eola Commons");
  });

  it("price-undisclosed listings rank last, never dropped by a price filter", async () => {
    const r = await searchService.search("3 bed under $3000");
    const prices = r.listings.map((l) => l.price);
    if (prices.includes(null)) {
      expect(prices[prices.length - 1]).toBeNull();
    }
  });

  it("results are ordered by total score (among price-disclosed listings)", async () => {
    const r = await searchService.search("2 bed");
    const scores = r.listings.filter((l) => l.price !== null).map((l) => l.score.total);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("reports timing with the seeded corpus size", async () => {
    const r = await searchService.search("studio");
    expect(r.timing.corpus).toBe(24);
    expect(r.timing.searchMs).toBeGreaterThanOrEqual(0);
    expect(r.timing.p50SearchMs).toBeGreaterThanOrEqual(0);
  });
});
```

Run: `npx vitest run lib/search.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

`web/lib/search.ts`:

```ts
import { buildSeedUnits, toListing } from "./seed";
import { parseQuery } from "./parse/llm-parse";
import type { Listing, ParsedQuery, SearchResult, SearchService } from "./types";

// In-memory corpus, built once per server process. Honest demo scope:
// this is the SearchService seam the spec (§3.1) says Postgres replaces.
function corpus(now: Date): Listing[] {
  return buildSeedUnits(now).map((u) => toListing(u, now));
}

function matches(l: Listing, p: ParsedQuery): boolean {
  if (p.neighborhoods.length > 0 && !p.neighborhoods.includes(l.neighborhood)) return false;
  if (p.priceMax !== null && l.price !== null && l.price > p.priceMax) return false; // null price passes — badged, ranked last
  if (p.bedsMin !== null && l.beds < p.bedsMin) return false;
  if (p.furnished !== null && l.furnished !== p.furnished) return false;
  if (p.shortTerm === true && !l.shortTermOk) return false;
  for (const a of p.amenities) if (!l.amenities.includes(a)) return false;
  if (p.residualText) {
    const hay = `${l.propertyName} ${l.neighborhood} ${l.description ?? ""}`.toLowerCase();
    if (!p.residualText.toLowerCase().split(/\s+/).some((w) => hay.includes(w))) return false;
  }
  return true;
}

const FRESHNESS_HALF_LIFE_DAYS = 3; // spec §5.5
function score(l: Listing, now: Date): Listing {
  const ageDays = (now.getTime() - new Date(l.lastConfirmedAt).getTime()) / 86_400_000;
  const freshness = Math.pow(0.5, ageDays / FRESHNESS_HALF_LIFE_DAYS);
  const trust =
    (l.price !== null ? 0.35 : 0) +
    (!l.priceIsStartingAt && l.price !== null ? 0.25 : 0) +
    (l.sqft !== null ? 0.15 : 0) +
    (l.description ? 0.15 : 0) +
    (l.amenities.length > 0 ? 0.1 : 0);
  const total = 0.45 * freshness + 0.45 * trust + 0.1 * (l.events.length >= 3 ? 1 : 0);
  return { ...l, score: { textRelevance: 0, freshness, trust, proximity: 0, total } };
}

const recentSearchMs: number[] = [];
function recordP50(ms: number): number {
  recentSearchMs.push(ms);
  if (recentSearchMs.length > 100) recentSearchMs.shift();
  const sorted = [...recentSearchMs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export const searchService: SearchService = {
  async search(rawQuery: string): Promise<SearchResult> {
    const now = new Date();
    const parsed = await parseQuery(rawQuery);
    const t0 = performance.now();
    const all = corpus(now);
    const scored = all.filter((l) => matches(l, parsed)).map((l) => score(l, now));
    scored.sort((a, b) => {
      if ((a.price === null) !== (b.price === null)) return a.price === null ? 1 : -1; // undisclosed price last
      return b.score.total - a.score.total;
    });
    const searchMs = Math.round((performance.now() - t0) * 100) / 100;
    return {
      listings: scored,
      parsed,
      totalCount: scored.length,
      timing: { parseMs: parsed.parseMs, searchMs, p50SearchMs: recordP50(searchMs), corpus: all.length },
    };
  },

  async getListing(id: string): Promise<Listing | null> {
    const now = new Date();
    return corpus(now).map((l) => score(l, now)).find((l) => l.id === id) ?? null;
  },
};
```

- [ ] **Step 4: Swap the pages to the real service and go GREEN**

In `web/app/page.tsx`, `web/app/listing/[id]/page.tsx`, `web/app/admin/page.tsx`: change `import { searchService } from "@/lib/mock-search"` to `from "@/lib/search"` (admin keeps its `SourceHealth` fixtures import if separate). Consult `web/node_modules/next/dist/docs/` if anything about the server-component pattern needs adjusting.

Run: `npx vitest run` → all green. `npx tsc --noEmit` → clean. `npm run build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add web/lib web/app
git commit -m "feat: real SearchService with ranking, timing, price-undisclosed handling"
```

---

### Task 5: Demo UI — true-cost card, time badges, provenance, timing

**Files:**
- Create: `web/components/TrueCostCard.tsx`, `web/components/TimeBadges.tsx`, `web/components/SeedBanner.tsx`
- Modify: `web/components/ParseEcho.tsx` (parse-source badge), `web/components/ListingCard.tsx` (time badges row), `web/app/page.tsx` (seed banner + timing line), `web/app/listing/[id]/page.tsx` (TrueCostCard)
- Test: `web/components/TrueCostCard.test.tsx`, `web/components/TimeBadges.test.tsx`

**Interfaces:**
- Consumes: `Listing.trueCost`, `Listing.events`, `Listing.daysOnMarket`, `ParsedQuery.parseSource`, `SearchResult.timing` — all from Tasks 2–4.
- Produces: the demo surface. Match the worktree's existing Tailwind tokens and component style exactly.

- [ ] **Step 1: Write failing component tests**

`web/components/TrueCostCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrueCostCard } from "./TrueCostCard";

const trueCost = {
  advertisedMonthly: 1895,
  concessionLabel: "6 wk free ÷ 13 mo",
  concessionMonthly: 202,
  netEffectiveMonthly: 1693,
  moveInFees: [
    { label: "Application fee", amount: 75 },
    { label: "Admin fee", amount: 250 },
  ],
};

describe("TrueCostCard", () => {
  it("shows the arithmetic: advertised − concession = net effective", () => {
    render(<TrueCostCard trueCost={trueCost} />);
    expect(screen.getByText("$1,895/mo")).toBeInTheDocument();
    expect(screen.getByText("−$202/mo")).toBeInTheDocument();
    expect(screen.getByText("$1,693/mo")).toBeInTheDocument();
    expect(screen.getByText("6 wk free ÷ 13 mo")).toBeInTheDocument();
  });

  it("the displayed numbers are internally consistent", () => {
    expect(trueCost.advertisedMonthly - trueCost.concessionMonthly).toBe(trueCost.netEffectiveMonthly);
  });

  it("lists move-in fees", () => {
    render(<TrueCostCard trueCost={trueCost} />);
    expect(screen.getByText("Application fee")).toBeInTheDocument();
    expect(screen.getByText("$250")).toBeInTheDocument();
  });
});
```

`web/components/TimeBadges.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimeBadges } from "./TimeBadges";
import type { ListingEvent } from "@/lib/types";

const NOW = new Date("2026-08-27T12:00:00.000Z");
const events: ListingEvent[] = [
  { at: "2026-07-11T12:00:00.000Z", kind: "first_listed", fromCents: null, toCents: 204500, note: null },
  { at: "2026-08-21T12:00:00.000Z", kind: "price_drop", fromCents: 204500, toCents: 189500, note: null },
  { at: "2026-08-24T12:00:00.000Z", kind: "concession_added", fromCents: null, toCents: null, note: "6 weeks free" },
];

describe("TimeBadges", () => {
  it("renders drop amount with date, days on market, and concession recency", () => {
    render(<TimeBadges events={events} daysOnMarket={47} now={NOW} />);
    expect(screen.getByText("↓$150 on Aug 21")).toBeInTheDocument();
    expect(screen.getByText("47 days on market")).toBeInTheDocument();
    expect(screen.getByText("concession added this week")).toBeInTheDocument();
  });
});
```

Run: `npx vitest run components/TrueCostCard.test.tsx components/TimeBadges.test.tsx` → FAIL (modules missing).

- [ ] **Step 2: Implement the components**

`web/components/TrueCostCard.tsx`:

```tsx
import type { TrueCost } from "@/lib/types";

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/** The concession math shown as arithmetic, not a mystery number. */
export function TrueCostCard({ trueCost }: { trueCost: TrueCost }) {
  return (
    <div className="rounded-card border border-hairline p-4">
      <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted">
        True monthly cost
      </h3>
      <dl className="mt-3 space-y-1.5 text-[15px]">
        <div className="flex items-baseline justify-between">
          <dt className="text-body">Advertised rent</dt>
          <dd className="font-medium text-ink">{usd(trueCost.advertisedMonthly)}/mo</dd>
        </div>
        <div className="flex items-baseline justify-between">
          <dt className="text-body">{trueCost.concessionLabel}</dt>
          <dd className="font-medium text-ink">
            {trueCost.concessionMonthly > 0 ? `−${usd(trueCost.concessionMonthly)}/mo` : "—"}
          </dd>
        </div>
        <div className="flex items-baseline justify-between border-t border-hairline pt-1.5">
          <dt className="font-bold text-ink">Net effective</dt>
          <dd className="font-bold text-ink">{usd(trueCost.netEffectiveMonthly)}/mo</dd>
        </div>
      </dl>
      {trueCost.moveInFees.length > 0 && (
        <dl className="mt-3 space-y-1 border-t border-hairline pt-2 text-[13px] text-muted">
          {trueCost.moveInFees.map((f) => (
            <div key={f.label} className="flex items-baseline justify-between">
              <dt>{f.label}</dt>
              <dd>{usd(f.amount)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
```

`web/components/TimeBadges.tsx`:

```tsx
import type { ListingEvent } from "@/lib/types";

const fmtDay = (isoAt: string) =>
  new Date(isoAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function timeBadgeLabels(events: ListingEvent[], daysOnMarket: number, now: Date): string[] {
  const out: string[] = [];
  const drops = events.filter((e) => e.kind === "price_drop" && e.fromCents !== null && e.toCents !== null);
  const lastDrop = drops[drops.length - 1];
  if (lastDrop) out.push(`↓$${Math.round((lastDrop.fromCents! - lastDrop.toCents!) / 100).toLocaleString("en-US")} on ${fmtDay(lastDrop.at)}`);
  out.push(`${daysOnMarket} days on market`);
  const lastConcession = events.filter((e) => e.kind === "concession_added").pop();
  if (lastConcession && now.getTime() - new Date(lastConcession.at).getTime() < 7 * 86_400_000) {
    out.push("concession added this week");
  }
  return out;
}

export function TimeBadges({ events, daysOnMarket, now }: { events: ListingEvent[]; daysOnMarket: number; now: Date }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {timeBadgeLabels(events, daysOnMarket, now).map((label) => (
        <span key={label} className="rounded-full bg-surface-2 px-2 py-0.5 text-[12px] text-body">
          {label}
        </span>
      ))}
    </div>
  );
}
```

(If `bg-surface-2` isn't an existing token in `globals.css`, use the closest existing muted-surface token — match, don't invent.)

`web/components/SeedBanner.tsx`:

```tsx
/** Honest provenance: the demo corpus is seeded, and says so. */
export function SeedBanner({ corpus }: { corpus: number }) {
  return (
    <p className="rounded-card border border-hairline px-3 py-2 text-[12px] text-muted">
      Demo corpus: {corpus} seeded Orlando listings, built to the v1_processed_unit_data
      schema. Live scraping lands post-demo — every number here is arithmetic, not
      scraped fact.
    </p>
  );
}
```

- [ ] **Step 3: Wire into pages and existing components**

- `ParseEcho.tsx`: after the chips, render a small badge for `parsed.parseSource` — `llm` → "parsed by Haiku · {parseMs}ms", `cache` → "parsed from cache", `fallback` → "keyword fallback". Keep the existing `failedOpen` message.
- `ListingCard.tsx`: render `<TimeBadges events={listing.events} daysOnMarket={listing.daysOnMarket} now={now} />` in the meta column; keep the existing price-drop line if redundant info doesn't double up (prefer TimeBadges; delete `lastDrop` if superseded).
- `app/page.tsx` (results view): render `<SeedBanner corpus={result.timing.corpus} />` above results and a timing line under the parse echo: `search {searchMs}ms · p50 {p50SearchMs}ms over {corpus} listings (in-memory)`.
- `app/listing/[id]/page.tsx`: render `<TrueCostCard trueCost={listing.trueCost} />` when non-null, and `<TimeBadges …/>`.

- [ ] **Step 4: GREEN + visual check**

Run: `npx vitest run` → all green (update any snapshot/text assertions the wiring changed). `npx tsc --noEmit` clean. `npm run dev` and load `/?q=pet friendly 2br under $2400 near Lake Eola with in-unit laundry` — confirm chips, badges, true-cost, timing, seed banner all render (screenshot for the report if possible).

- [ ] **Step 5: Commit**

```bash
git add web/components web/app
git commit -m "feat: true-cost card, time badges, provenance banner, parse-source badge"
```

---

### Task 6: DoD verification + README framing + merge readiness

**Files:**
- Modify: `web/README.md` (replace scaffold README with demo story)
- Test: whole suite + build + a scripted DoD checklist in the task report

**Interfaces:** none new — this task verifies and documents.

- [ ] **Step 1: README**

Rewrite `web/README.md` with: what the demo shows (schema-first pitch: extraction depth at ingest, NL parse at the front door), how to run it (`npm install; npm run dev`, optional `ANTHROPIC_API_KEY` for the live Haiku parse — without it the parser visibly falls back to keywords), the schema doc pointer (`docs/schema.md`), and a "Where the ideas come from" paragraph **obeying the framing constraints verbatim** (studied public payloads from my own browsing session; schema-implies-LLM-extraction phrased as inference; no anti-bot mentions; field-name homages named as homages: `collapse_key`, `liberal_dedup_cluster`, `original_source_id`).

- [ ] **Step 2: Run the DoD checklist and record evidence in the report**

1. `npx vitest run` → all green; `npx tsc --noEmit` → clean; `npm run build` → succeeds.
2. Dev server: the canonical query `pet friendly 2br under $2400 near Lake Eola with in-unit laundry` → parse echo shows every constraint in the query (Lake Eola Heights, Under $2,400, 2+ bd, pet friendly, in-unit laundry); with `ANTHROPIC_API_KEY` set the badge reads "parsed by Haiku"; without, "keyword fallback".
3. Listing detail for The Camellia: true-cost card shows $1,895 − $202 = $1,693 (arithmetically consistent by test).
4. ≥3 listings in search results render time badges (Camellia, Foundry SoDo, and every 5th varied unit have price-drop events).
5. Seed banner visible on results.
6. String sweep: `grep -ri "hiring" web/app web/components web/lib web/README.md` → only permitted field-name homages and the README's framing paragraph; nothing else.
7. `git log --oneline` — all Plan 2 commits carry the trailer.

- [ ] **Step 3: Commit, merge task branches, and stop**

```bash
git add web/README.md
git commit -m "docs: demo README with framing-compliant provenance story"
```

Merge the final task branch back into `worktree-web-ui-skeleton`. **Do not merge into master in this task** — the controller merges `worktree-web-ui-skeleton` → master only after the DoD evidence is reviewed and green (user ruling: "merge to master at the end if green").
