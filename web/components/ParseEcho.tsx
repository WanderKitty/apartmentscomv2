import type { ParsedQuery } from "@/lib/types";
import { formatPrice } from "@/lib/format";

function chips(parsed: ParsedQuery): string[] {
  const out: string[] = [...parsed.neighborhoods];
  if (parsed.priceMax !== null) out.push(`Under ${formatPrice(parsed.priceMax)}`);
  if (parsed.bedsMin !== null) {
    out.push(parsed.bedsMin === 0 ? "Studio+" : `${parsed.bedsMin}+ bd`);
  }
  if (parsed.furnished === true) out.push("Furnished");
  if (parsed.furnished === false) out.push("Unfurnished");
  if (parsed.shortTerm) out.push("Short term OK");
  out.push(...parsed.amenities);
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
    </div>
  );
}
