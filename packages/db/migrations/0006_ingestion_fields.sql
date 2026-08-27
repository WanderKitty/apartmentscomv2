-- Ingestion wiring: listings gain a source pointer for per-source sweeps
-- and admin counts; collapse_key becomes the enforced upsert identity
-- (every existing row was written with one by @aptv2/pipeline);
-- extract_cache memoizes per-property LLM extraction by content hash
-- (spec §5.3: "Results cached by content hash").
ALTER TABLE listings
  ADD COLUMN source_ref int REFERENCES sources(id),
  ALTER COLUMN collapse_key SET NOT NULL;

CREATE INDEX listings_source_ref ON listings (source_ref) WHERE source_ref IS NOT NULL;

CREATE TABLE extract_cache (
  content_hash text PRIMARY KEY,
  extracted    jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
