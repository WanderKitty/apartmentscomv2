import { Suspense } from "react";
import Link from "next/link";
import { SearchBar } from "@/components/SearchBar";
import { ParseEcho } from "@/components/ParseEcho";
import { ListingCard } from "@/components/ListingCard";
import { ResultsSkeleton } from "@/components/ResultsSkeleton";
import { ScrollTour } from "@/components/ScrollTour";
import { SeedBanner } from "@/components/SeedBanner";
import { searchService } from "@/lib/search";
import { EXAMPLE_QUERIES } from "@/lib/suggest";

const STATS: Array<[string, string]> = [
  ["Scraped 3×/day", "from the properties’ own websites"],
  ["Every price timestamped", "you see when we last confirmed it"],
  ["Zero reposted photos", "images and applications stay at the source"],
];

export default async function Home(props: PageProps<"/">) {
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const debug = sp.debug === "1";
  const now = new Date();

  if (!q) {
    return (
      <div className="mx-auto w-full max-w-[1080px] px-6 pb-24">
        {/* Hero */}
        <div className="mx-auto max-w-[720px] pt-16 md:pt-24">
          <h1 className="text-center text-[30px] font-bold leading-[1.35] tracking-[-0.3px] text-ink md:text-[36px]">
            Every listing, straight from the property.
          </h1>
          <p className="mx-auto mt-3 max-w-[560px] text-center text-[16px] leading-6 text-muted">
            Orlando apartments scraped 3×/day from community websites — prices
            timestamped, concessions decoded, nothing rehosted.
          </p>

          <div className="mt-8">
            <SearchBar />
          </div>

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {EXAMPLE_QUERIES.map((ex) => (
              <Link
                key={ex}
                href={`/?q=${encodeURIComponent(ex)}`}
                className="rounded-full border border-hairline px-3 py-1.5 text-[13px] text-body transition-colors hover:border-border-strong"
              >
                {ex}
              </Link>
            ))}
          </div>
        </div>

        {/* Scroll-driven product tour */}
        <div className="mt-24 md:mt-16">
          <ScrollTour />
        </div>

        {/* Stats band */}
        <div className="mt-20 grid gap-8 border-t border-hairline-soft pt-10 sm:grid-cols-3 md:mt-8">
          {STATS.map(([title, text]) => (
            <div key={title} className="text-center sm:text-left">
              <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
              <p className="mt-1 text-[14px] leading-[1.43] text-muted">
                {text}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[880px] px-6 pb-16 pt-8">
      <SearchBar defaultValue={q} />

      {/* The shell (search bar) paints immediately; the search itself —
          LLM parse + SQL — streams in behind the skeleton. Keyed by query
          so a new search re-shows the fallback instead of the stale page. */}
      <Suspense key={`${q}|${debug}`} fallback={<ResultsSkeleton />}>
        <SearchResults q={q} debug={debug} now={now} />
      </Suspense>
    </div>
  );
}

async function SearchResults({
  q,
  debug,
  now,
}: {
  q: string;
  debug: boolean;
  now: Date;
}) {
  const { listings, parsed, totalCount, timing, relaxationHints } =
    await searchService.search(q);
  const debugToggleHref = debug
    ? `/?q=${encodeURIComponent(q)}`
    : `/?q=${encodeURIComponent(q)}&debug=1`;

  return (
    <div>
      <div className="mt-4">
        <SeedBanner seed={timing.corpusSeed} scraped={timing.corpusScraped} />
      </div>

      <div className="mt-4">
        <ParseEcho parsed={parsed} />
        <p className="mt-1 text-[12px] text-muted-soft">
          search {timing.searchMs}ms · p50 {timing.p50SearchMs}ms over{" "}
          {timing.corpus} listings (Postgres)
        </p>
      </div>

      <div className="mt-6 flex items-baseline justify-between border-b border-hairline-soft pb-3">
        <p className="text-[14px] text-body">
          <span className="font-semibold text-ink">{totalCount}</span>{" "}
          {totalCount === 1 ? "listing" : "listings"} · ranked by relevance,
          freshness, and trust
        </p>
        <Link
          href={debugToggleHref}
          className="text-[13px] text-muted hover:text-ink hover:underline"
        >
          {debug ? "Hide score breakdown" : "Why this order?"}
        </Link>
      </div>

      {listings.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-[16px] font-semibold text-ink">
            No listings match everything you asked for.
          </p>
          <p className="mt-1 text-[14px] text-muted">
            Filters are hard limits, never fudged — but here is what one change
            would unlock:
          </p>
          {relaxationHints.length > 0 && (
            <ul className="mx-auto mt-4 flex max-w-[420px] flex-col gap-2">
              {relaxationHints.map((h) => (
                <li key={h.drop}>
                  <Link
                    href={`/?q=${encodeURIComponent(h.suggestedQuery)}`}
                    data-testid="relaxation-hint"
                    className="block rounded-card border border-hairline px-4 py-2 text-[14px] text-body hover:border-ink hover:text-ink"
                  >
                    removing <span className="font-semibold">{h.label}</span>{" "}
                    shows {h.count} {h.count === 1 ? "listing" : "listings"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-hairline-soft">
          {listings.map((listing, i) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              now={now}
              debug={debug}
              enterIndex={i}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
