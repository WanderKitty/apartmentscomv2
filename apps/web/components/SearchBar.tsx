"use client";
import Form from "next/form";
import { useId, useRef, useState } from "react";
import { buildSuggestions, type Suggestion } from "@/lib/suggest";
import { SearchButton } from "./SearchButton";

const KIND_LABEL: Record<Suggestion["kind"], string> = {
  neighborhood: "neighborhood",
  amenity: "amenity",
  example: "try it",
};

/**
 * The pill search bar with the 48px search orb, per the reference design
 * system (search-bar-pill + search-orb). Plain GET form → /?q=..., with
 * an autosuggest dropdown that completes neighborhoods, amenities, and
 * example queries as you type (↑↓ + Enter, Esc closes).
 */
export function SearchBar({ defaultValue = "" }: { defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const suggestions = open ? buildSuggestions(value) : [];
  const showList = open && suggestions.length > 0;

  const accept = (s: Suggestion) => {
    setValue(s.apply);
    setOpen(false);
    setActive(-1);
    // Accepting a suggestion is an intent to search — submit right away.
    // The DOM value must be written BEFORE requestSubmit: next/form reads
    // FormData synchronously inside the submit event, and React's state
    // update won't have flushed to the controlled input yet.
    const input = inputRef.current;
    if (input) {
      input.value = s.apply;
      input.form?.requestSubmit?.();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (!showList) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a + delta + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      accept(suggestions[active]!);
    }
  };

  return (
    <div className="relative">
      <Form
        action="/"
        onSubmit={() => {
          // Any submission (Enter with no highlight included) closes the
          // list — it would otherwise linger over the streamed-in results.
          setOpen(false);
          setActive(-1);
        }}
        className="flex h-16 w-full items-center gap-2 rounded-full border border-hairline bg-canvas py-2 pl-6 pr-2 shadow-tier transition-shadow duration-[var(--duration-micro)] focus-within:shadow-[0_0_0_2px_var(--color-ink),var(--shadow-tier)]"
      >
        <input
          ref={inputRef}
          type="text"
          name="q"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // mousedown on an option fires before blur, so clicks still land.
            setOpen(false);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          placeholder="Try “furnished 1br near Lake Eola under $2,000”"
          aria-label="Search Orlando apartments"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          maxLength={300}
          className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-muted-soft"
        />
        <SearchButton />
      </Form>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search suggestions"
          className="absolute inset-x-3 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-hairline-soft bg-canvas py-2 shadow-tier"
        >
          {suggestions.map((s, i) => (
            <li
              key={`${s.kind}:${s.label}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus in the input
                accept(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-baseline justify-between gap-4 px-5 py-2.5 text-[15px] text-ink ${
                i === active ? "bg-surface-soft" : ""
              }`}
            >
              <span className="truncate">{s.label}</span>
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.4px] text-muted-soft">
                {KIND_LABEL[s.kind]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
