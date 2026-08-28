"use client";
import Form from "next/form";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { buildSuggestions, type Suggestion } from "@/lib/suggest";
import { ResultsSkeleton } from "./ResultsSkeleton";
import { SearchButton } from "./SearchButton";

const KIND_LABEL: Record<Suggestion["kind"], string> = {
  filter: "filter",
  neighborhood: "neighborhood",
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
  const [overlayTop, setOverlayTop] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const router = useRouter();
  // The navigation runs inside our own transition: a searchParams-only
  // navigation never re-shows segment fallbacks, so the old page would sit
  // unchanged (verified in prod) — isPending drives an unmissable skeleton
  // overlay until the new results actually commit.
  const [isPending, startTransition] = useTransition();

  const suggestions = open ? buildSuggestions(value) : [];
  const showList = open && suggestions.length > 0;

  const navigate = (q: string) => {
    setOpen(false);
    setActive(-1);
    if (!q.trim()) return;
    setOverlayTop((wrapRef.current?.getBoundingClientRect().bottom ?? 0) + 16);
    startTransition(() => {
      router.push(`/?q=${encodeURIComponent(q.trim())}`);
    });
  };

  const accept = (s: Suggestion) => {
    setValue(s.apply);
    // Accepting a suggestion is an intent to search — go right away.
    navigate(s.apply);
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
    <div ref={wrapRef} className="relative z-50">
      <Form
        action="/"
        onSubmit={(e) => {
          // With JS, we navigate through our transition for pending
          // feedback; without it, the plain GET form still works.
          e.preventDefault();
          navigate(inputRef.current?.value ?? value);
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
          placeholder="Try “furnished 1 bed under $2,500”"
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
        <SearchButton pending={isPending} />
      </Form>

      {/* Search-in-flight: cover the stale page below the bar with the
          results skeleton until the navigation commits. */}
      {isPending && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 overflow-hidden bg-canvas"
          style={{ top: overlayTop }}
          aria-hidden
        >
          <div className="mx-auto w-full max-w-[1128px] px-6">
            <ResultsSkeleton />
          </div>
        </div>
      )}

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
