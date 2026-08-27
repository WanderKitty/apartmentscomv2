import Form from "next/form";

/**
 * The pill search bar with the 48px search orb, per the reference design
 * system (search-bar-pill + search-orb). Plain GET form → /?q=...
 */
export function SearchBar({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <Form
      action="/"
      className="flex h-16 w-full items-center gap-2 rounded-full border border-hairline bg-canvas py-2 pl-6 pr-2 shadow-tier"
    >
      <input
        type="text"
        name="q"
        defaultValue={defaultValue}
        placeholder="Try “furnished 1br near Lake Eola under $2,000”"
        aria-label="Search Orlando apartments"
        className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-muted-soft"
      />
      <button
        type="submit"
        aria-label="Search"
        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-rausch text-white transition-colors hover:bg-rausch-active"
      >
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
      </button>
    </Form>
  );
}
