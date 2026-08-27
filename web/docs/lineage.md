# Schema lineage — v1_processed_unit_data

The discipline behind this schema came from studying the public payloads of a job aggregator during my own browsing session (see README). Their 91-field enrichment implied LLM extraction at ingest; this maps each observed pattern to our apartment analog. Fields marked (homage) are borrowed deliberately.

| Their observed pattern | Ours | Note |
|---|---|---|
| 12 compensation fields (yearly→daily, min+max each) | rent_{monthly,weekly,daily,annual}_cents | one advertised value normalized to every frequency |
| is_compensation_transparent | is_price_transparent + price_level | "starting at" teasers flagged, never passed off as unit price |
| — (no job analog exists) | concession_* + net_effective_monthly_cents | concessions amortized into true monthly cost |
| min_industry_and_role_yoe + is_..._not_mentioned | is_X_not_mentioned companions throughout | absent ≠ zero, everywhere |
| workplace_cities/counties/states/... | neighborhood / city / county + lat/lng | renter-scale geography |
| estimated_publish_date (repost defeat) | estimated_publish_date + first_seen_at + last_confirmed_at | plus full event history |
| collapse_key, liberal_dedup_cluster, original_source_id | same names (homage) | two-tier cross-syndication dedup |
| company_signals (employer outcome signals) | management_signals (reserved) | their employer seam, our landlord seam |
| num_views, num_applies | num_views, num_saves (reserved) | demand signals |
| requirements_summary (generated) | generated_summary | NL summary per listing |
| enriched_company_data (19 fields) | property-enrichment group | year_built, unit_count, management_company, owner_portfolio |
| {platform}___{company}___{id} source ids | {platform}___{external_id} | source-of-truth identity |
