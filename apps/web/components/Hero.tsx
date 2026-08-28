import Link from "next/link";
import { SearchBar } from "@/components/SearchBar";
import { ScrollTour } from "@/components/ScrollTour";
import { EXAMPLE_QUERIES } from "@/lib/suggest";

const STATS: Array<[string, string]> = [
  ["Scraped 3×/day", "from the properties’ own websites"],
  ["Every price timestamped", "you see when we last confirmed it"],
  ["Zero reposted photos", "images and applications stay at the source"],
];

export function Hero() {
  return (
    <div className="mx-auto w-full max-w-[1080px] px-6 pb-24">
      {/* Hero */}
      <div className="mx-auto max-w-[720px] pt-16 md:pt-24">
        {/* display-xl per the reference doc: 28/700/1.43 — deliberately
            modest; the tour's product imagery carries the visual weight. */}
        <h1 className="text-center text-[28px] font-bold leading-[1.43] text-ink">
          Every listing, straight from the property.
        </h1>
        <p className="mx-auto mt-3 max-w-[560px] text-center text-[16px] leading-6 text-muted">
          Orlando apartments scraped 3×/day from community websites — prices
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
      </div>

      {/* Scroll-driven product tour */}
      <div className="mt-24 md:mt-16">
        <ScrollTour />
      </div>

      {/* Stats band */}
      <div className="mt-20 grid gap-8 border-t border-hairline-soft pt-10 sm:grid-cols-3 md:mt-8">
        {STATS.map(([title, text]) => (
          <div key={title} className="text-center sm:text-left">
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
