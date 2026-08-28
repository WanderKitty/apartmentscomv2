import { ResultsSkeleton } from "@/components/ResultsSkeleton";

/**
 * Instant fallback when navigating into the search route from another
 * segment (e.g. back from a listing page). Same-route searchParams
 * changes never re-show this — the SearchBar's pending overlay covers
 * those.
 */
export default function SearchLoading() {
  return (
    <div className="mx-auto w-full max-w-[1128px] px-6 pb-16 pt-8" aria-busy>
      <div className="mx-auto h-16 max-w-[880px] rounded-full skeleton" />
      <ResultsSkeleton />
    </div>
  );
}
