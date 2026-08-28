/**
 * Streaming fallback for the results block: mirrors the parse echo, the
 * count bar, and a page of list-cards so the layout doesn't jump when
 * real results land.
 */
export function ResultsSkeleton() {
  return (
    <div aria-hidden>
      <div className="mt-4 h-8 w-72 max-w-full rounded-full skeleton" />

      <div className="mt-6 flex items-baseline justify-between border-b border-hairline-soft pb-3">
        <div className="h-5 w-56 rounded-[6px] skeleton" />
        <div className="h-4 w-24 rounded-[6px] skeleton" />
      </div>

      <ul className="divide-y divide-hairline-soft">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="list-none">
            <div className="flex gap-4 p-3">
              <div className="size-28 shrink-0 rounded-[8px] skeleton sm:size-32" />
              <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
                <div className="h-6 w-32 rounded-[6px] skeleton" />
                <div className="h-5 w-64 max-w-full rounded-[6px] skeleton" />
                <div className="h-4 w-48 max-w-full rounded-[6px] skeleton" />
                <div className="h-4 w-40 max-w-full rounded-[6px] skeleton" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
