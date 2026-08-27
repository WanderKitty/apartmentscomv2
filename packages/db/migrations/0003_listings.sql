CREATE TABLE listings (
  id                       bigserial PRIMARY KEY,
  unit_id                  int NOT NULL REFERENCES units(id),
  property_id              int NOT NULL REFERENCES properties(id),
  neighborhood_id          int REFERENCES neighborhoods(id),
  location                 geography(Point, 4326),
  price_cents              int,
  price_is_starting_at     boolean NOT NULL DEFAULT false,
  net_effective_rent_cents int,
  concessions_text         text,
  available_on             date,
  lease_term               text NOT NULL DEFAULT 'unknown'
    CHECK (lease_term IN ('short', 'long', 'both', 'unknown')),
  furnished                boolean,
  status                   text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'stale', 'gone')),
  first_listed_at          timestamptz NOT NULL DEFAULT now(),
  last_confirmed_at        timestamptz NOT NULL DEFAULT now(),
  price_history            jsonb NOT NULL DEFAULT '[]',
  price_changes            int NOT NULL DEFAULT 0,
  trust_score              real NOT NULL DEFAULT 0,
  freshness_score          real NOT NULL DEFAULT 0,
  search_text              text,
  search_tsv               tsvector GENERATED ALWAYS AS
    (to_tsvector('english', coalesce(search_text, ''))) STORED
);

CREATE INDEX listings_search_tsv ON listings USING GIN (search_tsv);
CREATE INDEX listings_location ON listings USING GIST (location);
CREATE INDEX listings_active_filter
  ON listings (status, neighborhood_id, price_cents);
CREATE INDEX listings_unit ON listings (unit_id);
