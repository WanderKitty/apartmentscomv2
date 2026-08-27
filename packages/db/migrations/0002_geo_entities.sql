CREATE TABLE neighborhoods (
  id       serial PRIMARY KEY,
  metro    text NOT NULL DEFAULT 'orlando',
  name     text NOT NULL,
  aliases  text[] NOT NULL DEFAULT '{}',
  boundary geography(MultiPolygon, 4326) NOT NULL,
  UNIQUE (metro, name)
);
CREATE INDEX neighborhoods_boundary ON neighborhoods USING GIST (boundary);

CREATE TABLE properties (
  id                 serial PRIMARY KEY,
  source_id          int REFERENCES sources(id),
  name               text NOT NULL,
  address_line1      text NOT NULL,
  city               text NOT NULL,
  state              text NOT NULL,
  zip                text NOT NULL,
  normalized_address text NOT NULL UNIQUE,
  location           geography(Point, 4326) NOT NULL,
  neighborhood_id    int REFERENCES neighborhoods(id),
  amenities          text[] NOT NULL DEFAULT '{}',
  photo_urls         text[] NOT NULL DEFAULT '{}',
  management_company text,
  website_url        text,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX properties_location ON properties USING GIST (location);

CREATE TABLE units (
  id           serial PRIMARY KEY,
  property_id  int NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('floorplan', 'unit')),
  floorplan_id int REFERENCES units(id),
  external_id  text NOT NULL,
  name         text,
  beds         numeric,
  baths        numeric,
  sqft         int,
  amenities    text[] NOT NULL DEFAULT '{}',
  UNIQUE (property_id, kind, external_id)
);
