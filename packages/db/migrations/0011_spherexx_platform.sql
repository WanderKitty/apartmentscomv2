-- Spherexx marketing-site adapter (Plan 6 Task 7): the sources registry's
-- platform CHECK predates the adapter and rejects 'spherexx' registrations.
ALTER TABLE sources DROP CONSTRAINT sources_platform_check;
ALTER TABLE sources ADD CONSTRAINT sources_platform_check
  CHECK (platform IN ('rentcafe', 'appfolio', 'entrata', 'spherexx', 'unknown'));
