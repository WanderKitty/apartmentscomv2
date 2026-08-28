import { Suspense } from "react";
import Link from "next/link";
import { SearchBar } from "@/components/SearchBar";
import { ParseEcho } from "@/components/ParseEcho";
import { Hero } from "@/components/Hero";
import { ListingCard } from "@/components/ListingCard";
import { ResultsSkeleton } from "@/components/ResultsSkeleton";
import { SeedBanner } from "@/components/SeedBanner";
import { searchService } from "@/lib/search";

export default async function Home(props: PageProps<"/">) {
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const debug = sp.debug === "1";
  const now = new Date();

  // Normally unreachable: the next.config.ts rewrite serves the static
  // /hero page when no ?q= is present. This covers a present-but-blank
  // query ("/?q=") the same way.
  if (!q) return <Hero />;

  return (
    <div className="mx-auto w-full max-w-[1128px] px-6 pb-16 pt-8">
      <div className="mx-auto max-w-[880px]">
        <SearchBar defaultValue={q} />
      </div>

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
        <ul className="mt-6 grid grid-cols-1 gap-x-4 gap-y-10 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
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
