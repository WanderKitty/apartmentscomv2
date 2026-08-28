# apartmentscomv2

An Orlando apartment search engine: primary-source listings scraped politely
from communities' own public sites, structured at ingest, scored for trust and
freshness, and served behind a natural-language search bar.

Full runbook: [`apps/web/README.md`](apps/web/README.md).

## Automation

- **CI** (`.github/workflows/ci.yml`) — typecheck, every package's test suite
  against a PostGIS service container, and the production web build, on every
  push.
- **Scrape** (`.github/workflows/scrape.yml`) — scheduled polite scraping of
  the registered sources, three times daily.
- **AI Evals** (`.github/workflows/evals.yml`) — a golden query-parse
  regression, an extraction-sampling eval judged by a stronger model, and a
  deterministic filter-satisfaction sweep; on master merges and nightly.

This repository is private: it contains captured availability-payload fixtures
used as test data, and the project is a time-boxed demo.
