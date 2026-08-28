-- Review finding (Task 5 fixes): geocode_cache must also cache MISSES (a
-- query Nominatim genuinely has no result for), not just hits — otherwise a
-- repeated identical failing query re-hits Nominatim on every run, forever.
-- A cached miss is recorded as a row with NULL coordinates, so the NOT NULL
-- constraint from migration 0009 has to go.
ALTER TABLE geocode_cache ALTER COLUMN latitude DROP NOT NULL;
ALTER TABLE geocode_cache ALTER COLUMN longitude DROP NOT NULL;
