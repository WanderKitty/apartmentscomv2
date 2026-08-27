CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE sources (
  id             serial PRIMARY KEY,
  platform       text NOT NULL CHECK (platform IN ('rentcafe', 'appfolio', 'entrata', 'unknown')),
  name           text NOT NULL,
  website_url    text NOT NULL UNIQUE,
  endpoint_config jsonb NOT NULL DEFAULT '{}',
  robots_policy  jsonb,
  rate_limit_rps numeric NOT NULL DEFAULT 1,
  enabled        boolean NOT NULL DEFAULT true,
  last_scraped_at timestamptz,
  failure_streak int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE raw_snapshots (
  id                bigserial PRIMARY KEY,
  source_id         int NOT NULL REFERENCES sources(id),
  fetched_at        timestamptz NOT NULL DEFAULT now(),
  content_hash      text NOT NULL,
  payload           jsonb NOT NULL,
  processing_status text NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'processed', 'failed', 'skipped_unchanged')),
  error             text
);

CREATE INDEX raw_snapshots_source_fetched
  ON raw_snapshots (source_id, fetched_at DESC);
CREATE INDEX raw_snapshots_source_hash
  ON raw_snapshots (source_id, content_hash);
