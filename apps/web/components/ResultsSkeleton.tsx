/**
 * Streaming fallback for the results block: mirrors the parse echo, the
 * count bar, and a page of photo-first cards so the layout doesn't jump
 * when real results land.
 */
export function ResultsSkeleton() {
  return (
    <div aria-hidden>
      <div className="mt-4 h-8 w-72 max-w-full rounded-full skeleton" />

      <div className="mt-6 flex items-baseline justify-between border-b border-hairline-soft pb-3">
        <div className="h-5 w-56 rounded-[6px] skeleton" />
        <div className="h-4 w-24 rounded-[6px] skeleton" />
      </div>

      <ul className="mt-6 grid grid-cols-1 gap-x-4 gap-y-10 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i} className="list-none">
            <div className="aspect-square rounded-card skeleton" />
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex justify-between gap-3">
                <div className="h-5 w-28 rounded-[6px] skeleton" />
                <div className="h-5 w-16 rounded-[6px] skeleton" />
              </div>
              <div className="h-4 w-40 max-w-full rounded-[6px] skeleton" />
              <div className="h-4 w-32 max-w-full rounded-[6px] skeleton" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
