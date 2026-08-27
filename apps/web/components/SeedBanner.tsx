/** Honest provenance: the demo corpus is seeded, and says so. */
export function SeedBanner({ corpus }: { corpus: number }) {
  return (
    <p className="rounded-card border border-hairline px-3 py-2 text-[12px] text-muted">
      Demo corpus: {corpus} seeded Orlando listings, built to the v1_processed_unit_data
      schema. Live scraping lands post-demo — every number here is arithmetic, not
      scraped fact.
    </p>
  );
}
