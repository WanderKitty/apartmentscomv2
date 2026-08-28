import Form from "next/form";
import { SearchButton } from "./SearchButton";

/**
 * The pill search bar with the 48px search orb, per the reference design
 * system (search-bar-pill + search-orb). Plain GET form → /?q=...
 */
export function SearchBar({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <Form
      action="/"
      className="flex h-16 w-full items-center gap-2 rounded-full border border-hairline bg-canvas py-2 pl-6 pr-2 shadow-tier transition-shadow duration-[var(--duration-micro)] focus-within:shadow-[0_0_0_2px_var(--color-ink),var(--shadow-tier)]"
    >
      <input
        type="text"
        name="q"
        defaultValue={defaultValue}
        placeholder="Try “furnished 1br near Lake Eola under $2,000”"
        aria-label="Search Orlando apartments"
        className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-muted-soft"
      />
      <SearchButton />
    </Form>
  );
}
