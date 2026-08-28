/**
 * Skeleton mirroring the listing detail layout — hero plate, title block,
 * sections left, price rail right — so the content swap doesn't jump.
 * Shown as a pending overlay while a card's navigation is in flight (a
 * route-level loading.tsx would force streaming and turn honest 404s
 * into 200s, so the feedback lives client-side instead).
 */
export function ListingDetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1080px] px-6 pb-16 pt-6" aria-hidden>
      <div className="progress-track h-1 w-full">
        <div className="progress-bar" />
      </div>
      <p className="mt-3 flex items-center gap-2 text-[14px] font-medium text-ink">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-rausch)"
          strokeWidth="3"
          strokeLinecap="round"
          className="spinner"
          aria-hidden
        >
          <path d="M12 2.5 A9.5 9.5 0 1 1 2.5 12" />
        </svg>
        Loading listing…
      </p>
      <div className="mt-4 h-5 w-28 rounded-[6px] skeleton" />

      <div className="mt-4 h-64 rounded-card skeleton md:h-80" />

      <div className="mt-8 flex flex-col gap-10 md:flex-row">
        <div className="min-w-0 md:w-[64%]">
          <div className="h-7 w-64 max-w-full rounded-[6px] skeleton" />
          <div className="mt-2 h-4 w-80 max-w-full rounded-[6px] skeleton" />
          <div className="mt-4 flex gap-2">
            <div className="h-7 w-32 rounded-full skeleton" />
            <div className="h-7 w-28 rounded-full skeleton" />
          </div>
          <div className="mt-5 h-5 w-48 rounded-[6px] skeleton" />

          <div className="mt-8 border-t border-hairline-soft pt-6">
            <div className="h-5 w-24 rounded-[6px] skeleton" />
            <div className="mt-3 h-64 rounded-card skeleton md:h-72" />
          </div>
        </div>

        <div className="hidden md:block md:w-[32%]">
          <div className="rounded-card border border-hairline p-6 shadow-tier">
            <div className="h-7 w-32 rounded-[6px] skeleton" />
            <div className="mt-4 h-32 rounded-card skeleton" />
            <div className="mt-4 h-12 rounded-[8px] skeleton" />
          </div>
        </div>
      </div>
    </div>
  );
}
