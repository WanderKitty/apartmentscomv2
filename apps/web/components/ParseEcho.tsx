import type { ParsedQuery } from "@/lib/types";
import { formatPrice } from "@/lib/format";

function parseSourceLabel(parsed: ParsedQuery): string {
  switch (parsed.parseSource) {
    case "llm":
      return `parsed by Haiku · ${parsed.parseMs}ms`;
    case "cache":
      return "parsed from cache";
    case "fallback":
      return "keyword fallback";
  }
}

function chips(parsed: ParsedQuery): string[] {
  const out: string[] = [...parsed.neighborhoods, ...parsed.cities];
  if (parsed.priceMax !== null) out.push(`Under ${formatPrice(parsed.priceMax)}`);
  if (parsed.bedsMin !== null) {
    // Exact when both bounds agree ("1 bedroom" → "1 bd"); open-ended
    // phrasings ("1+ br", "at least 1") keep the plus.
    const exact = parsed.bedsMax === parsed.bedsMin;
    if (parsed.bedsMin === 0) out.push(exact ? "Studio" : "Studio+");
    else out.push(exact ? `${parsed.bedsMin} bd` : `${parsed.bedsMin}+ bd`);
  }
  if (parsed.furnished === true) out.push("Furnished");
  if (parsed.furnished === false) out.push("Unfurnished");
  if (parsed.shortTerm) out.push("Short term OK");
  out.push(...parsed.amenities);
  // Ordering intent is understanding too — show it, else "cheapest" feels
  // like it vanished (it did, before sort semantics existed).
  if (parsed.sort === "price_asc") out.push("Sorted by price ↑");
  else if (parsed.sort === "price_desc") out.push("Sorted by price ↓");
  else if (parsed.sort === "newest") out.push("Newest first");
  else if (parsed.sort === "sqft_asc") out.push("Smallest first");
  else if (parsed.sort === "sqft_desc") out.push("Biggest first");
  if (parsed.residualText) out.push(`“${parsed.residualText}” as keywords`);
  return out;
}

/**
 * The parse echo — shows what the query parser understood (spec §6.1),
 * so the search never feels like a black box.
 */
export function ParseEcho({ parsed }: { parsed: ParsedQuery }) {
  const items = chips(parsed);
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12px] font-bold text-muted">
        What we understood
      </span>
      {items.map((label) => (
        <span
          key={label}
          className="rounded-full border border-hairline px-3 py-1 text-[13px] text-ink"
        >
          {label}
        </span>
      ))}
      {parsed.failedOpen && (
        <span className="text-[13px] text-muted">
          — couldn’t parse filters, searching the words themselves
        </span>
      )}
      <span className="text-[12px] text-muted-soft">
        {parseSourceLabel(parsed)}
      </span>
    </div>
  );
}
