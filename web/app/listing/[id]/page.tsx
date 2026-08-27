import Link from "next/link";
import { notFound } from "next/navigation";
import { FreshnessBadge } from "@/components/FreshnessBadge";
import { searchService } from "@/lib/mock-search";
import {
  formatBedsBaths,
  formatPrice,
  formatSqft,
  relativeTime,
} from "@/lib/format";

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default async function ListingPage(props: PageProps<"/listing/[id]">) {
  const { id } = await props.params;
  const listing = await searchService.getListing(id);
  if (!listing) notFound();
  const now = new Date();

  const facts = [
    formatBedsBaths(listing.beds, listing.baths),
    formatSqft(listing.sqft),
    listing.furnished ? "Furnished" : null,
    listing.shortTermOk ? "Short-term OK" : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto w-full max-w-[1080px] px-6 pb-16 pt-6">
      <Link
        href="/"
        className="text-[14px] text-muted hover:text-ink hover:underline"
      >
        ← Back to search
      </Link>

      {/* Photos are linked from the source site, never rehosted (spec §7). */}
      <div className="mt-4 flex h-64 flex-col items-center justify-center gap-2 rounded-card bg-surface-strong md:h-80">
        <span className="text-[8px] font-bold uppercase tracking-[0.32px] text-muted-soft">
          Photos stay at the source
        </span>
        <a
          href={listing.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[14px] font-medium text-ink underline"
        >
          View photos on the property site ↗
        </a>
      </div>

      <div className="mt-8 flex flex-col gap-10 md:flex-row">
        {/* Left column — 64% */}
        <div className="min-w-0 md:w-[64%]">
          <h1 className="text-[22px] font-medium tracking-[-0.44px] text-ink">
            {listing.propertyName}
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            {listing.address} · {listing.neighborhood}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <FreshnessBadge
              lastConfirmedAt={listing.lastConfirmedAt}
              now={now}
            />
            {listing.status === "stale" && (
              <span className="rounded-full border border-hairline px-2.5 py-1 text-[11px] font-semibold text-error">
                Not seen recently — may be gone
              </span>
            )}
          </div>

          <p className="mt-4 text-[16px] font-medium text-ink">
            {facts.join(" · ")}
          </p>

          {listing.description && (
            <p className="mt-4 text-[16px] leading-6 text-body">
              {listing.description}
            </p>
          )}

          {listing.amenities.length > 0 && (
            <section className="mt-8 border-t border-hairline-soft pt-6">
              <h2 className="text-[16px] font-semibold text-ink">Amenities</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {listing.amenities.map((a) => (
                  <span
                    key={a}
                    className="rounded-full border border-hairline px-3 py-1 text-[13px] text-body"
                  >
                    {a}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="mt-8 border-t border-hairline-soft pt-6">
            <h2 className="text-[16px] font-semibold text-ink">
              Price history
            </h2>
            {listing.priceHistory.length === 0 ? (
              <p className="mt-2 text-[14px] text-muted">
                No price changes since we first saw this listing on{" "}
                {longDate(listing.firstListedAt)}.
              </p>
            ) : (
              <table className="mt-3 w-full text-[14px]">
                <tbody>
                  {listing.priceHistory.map((c) => (
                    <tr key={c.at} className="border-b border-hairline-soft">
                      <td className="py-2 text-muted">{longDate(c.at)}</td>
                      <td className="py-2 text-body">
                        {formatPrice(c.from)} → {formatPrice(c.to)}
                      </td>
                      <td
                        className={`py-2 text-right font-medium ${
                          c.to < c.from ? "text-success" : "text-error"
                        }`}
                      >
                        {c.to < c.from ? "↓" : "↑"}{" "}
                        {formatPrice(Math.abs(c.to - c.from))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="mt-8 rounded-card bg-surface-soft p-5">
            <h2 className="text-[12px] font-bold text-muted">
              About this data
            </h2>
            <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-4">
              <div>
                <dt className="text-muted-soft">Source platform</dt>
                <dd className="text-body">{listing.platform}</dd>
              </div>
              <div>
                <dt className="text-muted-soft">First seen</dt>
                <dd className="text-body">{longDate(listing.firstListedAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-soft">Last confirmed</dt>
                <dd className="text-body">
                  {relativeTime(listing.lastConfirmedAt, now)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-soft">Status</dt>
                <dd className="text-body">{listing.status}</dd>
              </div>
            </dl>
          </section>
        </div>

        {/* Right rail — 32%, sticky (the reference system's reservation-card
            pattern, repurposed as the view-at-source card). */}
        <div className="md:w-[32%]">
          <div className="sticky top-6 rounded-card border border-hairline p-6 shadow-tier">
            {listing.price !== null ? (
              <p className="text-[21px] font-bold text-ink">
                {formatPrice(listing.price)}
                <span className="text-[14px] font-normal text-muted">
                  {" "}
                  /mo
                </span>
              </p>
            ) : (
              <p className="text-[16px] font-semibold text-muted">
                Price not listed by the property
              </p>
            )}

            {listing.priceIsStartingAt && (
              <p className="mt-1 text-[13px] text-muted">
                “Starting at” price — actual units may cost more.
              </p>
            )}

            {listing.netEffectiveRent !== null && (
              <p className="mt-2 text-[14px] font-medium text-success">
                ≈ {formatPrice(listing.netEffectiveRent)} net effective with
                concessions
              </p>
            )}

            {listing.concessionsText && (
              <p className="mt-1 text-[13px] text-body">
                Current offer: {listing.concessionsText}
              </p>
            )}

            <div className="my-4 border-t border-hairline-soft" />

            {listing.availableDate && (
              <p className="text-[14px] text-body">
                Available{" "}
                {new Date(
                  listing.availableDate + "T00:00:00",
                ).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                })}
              </p>
            )}

            <a
              href={listing.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex h-12 items-center justify-center rounded-[8px] bg-rausch px-6 text-[16px] font-medium text-white transition-colors hover:bg-rausch-active"
            >
              View at property site ↗
            </a>
            <p className="mt-2 text-center text-[13px] text-muted">
              You apply on the property’s own site. We never collect fees.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
