-- Serving fields proven out by the Plan-2 demo UI. collapse_key /
-- dedup_cluster are the two-tier dedup homage fields (see web README
-- framing); collapse_key is the idempotent-upsert identity.
ALTER TABLE listings
  ADD COLUMN collapse_key           text UNIQUE,
  ADD COLUMN dedup_cluster          text,
  ADD COLUMN source_platform        text NOT NULL DEFAULT 'seed',
  ADD COLUMN source_external_id     text,
  ADD COLUMN source_url             text,
  ADD COLUMN provenance             text NOT NULL DEFAULT 'seed'
    CHECK (provenance IN ('seed', 'scraped')),
  ADD COLUMN estimated_publish_date date,
  ADD COLUMN description            text,
  ADD COLUMN events                 jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN move_in_fees           jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN concession             jsonb;

CREATE INDEX listings_dedup_cluster ON listings (dedup_cluster);
CREATE INDEX listings_source_identity ON listings (source_platform, source_external_id);
