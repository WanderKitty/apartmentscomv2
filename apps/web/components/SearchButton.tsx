"use client";

/** The 48px search orb; swaps to a spinner the instant a search is pending. */
export function SearchButton({ pending = false }: { pending?: boolean }) {
  return (
    <button
      type="submit"
      aria-label="Search"
      aria-busy={pending}
      className="flex size-12 shrink-0 items-center justify-center rounded-full bg-rausch text-white transition-colors duration-[var(--duration-micro)] hover:bg-rausch-active"
    >
      {pending ? (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          className="spinner"
          aria-hidden
        >
          <path d="M12 2.5 A9.5 9.5 0 1 1 2.5 12" />
        </svg>
      ) : (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          aria-hidden
        >
          <circle cx="10.5" cy="10.5" r="7" />
          <line x1="15.8" y1="15.8" x2="21" y2="21" />
        </svg>
      )}
    </button>
  );
}
