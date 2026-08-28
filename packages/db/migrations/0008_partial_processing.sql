-- Partial processing visibility (prod incident 2026-08-28): a snapshot whose
-- unit extraction partially failed must be distinguishable from a fully
-- processed one, so the unchanged-hash short-circuit can decline to skip.
ALTER TABLE raw_snapshots DROP CONSTRAINT raw_snapshots_processing_status_check;
ALTER TABLE raw_snapshots ADD CONSTRAINT raw_snapshots_processing_status_check
  CHECK (processing_status IN ('pending', 'processed', 'partial', 'failed', 'skipped_unchanged'));
