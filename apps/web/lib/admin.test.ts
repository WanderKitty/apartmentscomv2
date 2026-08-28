// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import type { getPool } from "@aptv2/db";
import { getSourceHealth } from "./admin";

let pool: ReturnType<typeof getPool>;
let sourceId: number;

beforeAll(async () => {
  config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { getPool } = await import("@aptv2/db");
  const { resetTestDb } = await import("@aptv2/db/test-helpers");
  pool = getPool();
  await resetTestDb(pool);

  const { rows: src } = await pool.query(
    `INSERT INTO sources (platform, name, website_url, enabled, last_scraped_at, failure_streak)
     VALUES ('entrata', 'Fixture Community', 'https://example.com/fixture', true, now(), 1)
     RETURNING id`,
  );
  sourceId = src[0].id;

  // Two scrape runs for this source: the current one found 12 listings; the
  // newest run older than 24h found 10 — listingDelta24h should be 12 - 10.
  await pool.query(
    `INSERT INTO scrape_runs (source_id, started_at, finished_at, status, listings_found)
     VALUES ($1, now(), now(), 'ok', 12)`,
    [sourceId],
  );
  await pool.query(
    `INSERT INTO scrape_runs (source_id, started_at, finished_at, status, listings_found)
     VALUES ($1, now() - interval '25 hours', now() - interval '25 hours', 'ok', 10)`,
    [sourceId],
  );

  const { rows: prop } = await pool.query(
    `INSERT INTO properties (name, address_line1, city, state, zip, normalized_address, location)
     VALUES ('Fixture Property', '1 Fixture St', 'Orlando', 'FL', '32801',
             '1 fixture st orlando fl 32801',
             ST_SetSRID(ST_MakePoint(-81.38, 28.54), 4326)::geography)
     RETURNING id`,
  );
  const propertyId = prop[0].id;
  const { rows: unit } = await pool.query(
    `INSERT INTO units (property_id, kind, external_id, beds, baths)
     VALUES ($1, 'unit', 'u1', 1, 1) RETURNING id`,
    [propertyId],
  );
  const unitId = unit[0].id;

  for (const key of ["admin-fixture-1", "admin-fixture-2"]) {
    await pool.query(
      `INSERT INTO listings (unit_id, property_id, status, collapse_key, source_ref)
       VALUES ($1, $2, 'active', $3, $4)`,
      [unitId, propertyId, key, sourceId],
    );
  }
});

afterAll(async () => {
  const { closePool } = await import("@aptv2/db");
  await closePool();
});

describe("getSourceHealth", () => {
  it("computes activeListings and listingDelta24h from real sources/scrape_runs/listings rows", async () => {
    const health = await getSourceHealth(pool);
    const row = health.find((h) => h.name === "Fixture Community");
    expect(row).toBeDefined();
    expect(row!.platform).toBe("entrata");
    expect(row!.enabled).toBe(true);
    expect(row!.failureStreak).toBe(1);
    expect(row!.activeListings).toBe(2);
    expect(row!.listingDelta24h).toBe(2);
  });
});
