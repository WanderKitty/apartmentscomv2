-- Geocode fallback cache (Plan 6 Task 5): Nominatim is used only when a
-- discovery candidate's own site markup lacks address/geo. Caching by the
-- exact query string means a repeated discover-cli run (or a re-verify of
-- the same candidate) never re-geocodes the same address, keeping the
-- Nominatim usage policy's ≤1 req/s honest across many invocations.
CREATE TABLE geocode_cache (
  query text PRIMARY KEY,
  latitude float8 NOT NULL,
  longitude float8 NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
