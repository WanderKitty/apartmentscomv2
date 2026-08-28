/**
 * Honest provenance, both kinds: seeded demo rows and scraped rows are
 * labeled, and neither clause renders when its count is 0 — production
 * runs with zero seeded listings, so "0 seeded" must never appear.
 */
export function SeedBanner({ seed, scraped }: { seed: number; scraped: number }) {
  const seedClause =
    seed > 0
      ? `${seed} seeded demo listings (built to the v1_processed_unit_data schema; every number is arithmetic, not scraped fact)`
      : "";
  const scrapedClause =
    scraped > 0
      ? `${scraped} listings scraped from public property sites, refreshed on a schedule`
      : "";

  const body =
    seedClause && scrapedClause
      ? `Corpus: ${seedClause} + ${scrapedClause}.`
      : seedClause
        ? `Corpus: ${seedClause}.`
        : scrapedClause
          ? `Corpus: ${scrapedClause}.`
          : "Corpus: no listings yet.";

  return (
    <p className="rounded-card border border-hairline px-3 py-2 text-[12px] text-muted">
      {body}
    </p>
  );
}
