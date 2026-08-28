import Link from "next/link";
import { SearchBar } from "@/components/SearchBar";

const EXAMPLE_QUERIES = [
  "furnished 1br near Lake Eola under $2,000",
  "2 bed in Baldwin Park with a pool",
  "pet friendly studio in College Park",
];

const TRUST_POINTS: Array<[string, string]> = [
  [
    "Confirmed, not copied",
    "Every listing is scraped from the property's own website and stamped with when we last saw it there.",
  ],
  [
    "Prices decoded",
    "“Starting at” prices are flagged, and concessions are turned into the net rent you'd actually pay.",
  ],
  [
    "Straight to the source",
    "We link you to the property's site to apply. No middlemen, no fees, no reposted photos.",
  ],
];

export function Hero() {
  return (
    <div className="mx-auto w-full max-w-[720px] px-6 pb-16 pt-16 md:pt-24">
      <h1 className="text-center text-[28px] font-bold leading-[1.43] text-ink">
        Every listing, straight from the property.
      </h1>
      <p className="mx-auto mt-2 max-w-[560px] text-center text-[16px] leading-6 text-muted">
        Orlando apartments scraped daily from community websites — prices
        timestamped, concessions decoded, nothing rehosted.
      </p>

      <div className="mt-8">
        <SearchBar />
      </div>

      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {EXAMPLE_QUERIES.map((ex) => (
          <Link
            key={ex}
            href={`/?q=${encodeURIComponent(ex)}`}
            className="rounded-full border border-hairline px-3 py-1.5 text-[13px] text-body transition-colors hover:border-border-strong"
          >
            {ex}
          </Link>
        ))}
      </div>

      <div className="mt-16 grid gap-8 border-t border-hairline-soft pt-10 sm:grid-cols-3">
        {TRUST_POINTS.map(([title, text]) => (
          <div key={title}>
            <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
            <p className="mt-1 text-[14px] leading-[1.43] text-muted">
              {text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
