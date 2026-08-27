CREATE TABLE scrape_runs (
  id               bigserial PRIMARY KEY,
  source_id        int NOT NULL REFERENCES sources(id),
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  status           text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'ok', 'failed', 'partial')),
  listings_found   int NOT NULL DEFAULT 0,
  listings_changed int NOT NULL DEFAULT 0,
  error            text
);
CREATE INDEX scrape_runs_source ON scrape_runs (source_id, started_at DESC);

CREATE TABLE search_logs (
  id                  bigserial PRIMARY KEY,
  created_at          timestamptz NOT NULL DEFAULT now(),
  raw_query           text NOT NULL,
  parsed_filters      jsonb,
  parse_source        text NOT NULL CHECK (parse_source IN ('cache', 'llm', 'fallback')),
  result_count        int,
  clicked_listing_ids bigint[] NOT NULL DEFAULT '{}'
);

CREATE TABLE query_parses (
  normalized_query text PRIMARY KEY,
  parsed_filters   jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  hit_count        int NOT NULL DEFAULT 1
);

CREATE TABLE review_queue (
  id         serial PRIMARY KEY,
  kind       text NOT NULL,
  payload    jsonb NOT NULL,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now()
);
