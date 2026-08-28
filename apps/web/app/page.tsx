import { Suspense } from "react";
import Link from "next/link";
import { SearchBar } from "@/components/SearchBar";
import { ParseEcho } from "@/components/ParseEcho";
import { ListingCard } from "@/components/ListingCard";
import { ResultsSkeleton } from "@/components/ResultsSkeleton";
import { SeedBanner } from "@/components/SeedBanner";
import { searchService } from "@/lib/search";

const EXAMPLE_QUERIES = [
  "furnished 1br near Lake Eola under $2,000",
  "2 bed in Baldwin Park with a pool",
  "pet friendly studio in College Park",
];

const TRUST_POINTS: Array<[string, string]> = [
  [
    "Confirmed, not copied",
    "Every listing is scraped from the property's own website and stamped with when we last saw it there.",
  ],
  [
    "Prices decoded",
    "“Starting at” prices are flagged, and concessions are turned into the net rent you'd actually pay.",
  ],
  [
    "Straight to the source",
    "We link you to the property's site to apply. No middlemen, no fees, no reposted photos.",
  ],
];

export default async function Home(props: PageProps<"/">) {
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const debug = sp.debug === "1";
  const now = new Date();

  if (!q) {
    return (
      <div className="mx-auto w-full max-w-[720px] px-6 pb-16 pt-16 md:pt-24">
        <h1 className="text-center text-[28px] font-bold leading-[1.43] text-ink">
          Every listing, straight from the property.
        </h1>
        <p className="mx-auto mt-2 max-w-[560px] text-center text-[16px] leading-6 text-muted">
          Orlando apartments scraped daily from community websites — prices
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

        <div className="mt-16 grid gap-8 border-t border-hairline-soft pt-10 sm:grid-cols-3">
          {TRUST_POINTS.map(([title, text]) => (
            <div key={title}>
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
