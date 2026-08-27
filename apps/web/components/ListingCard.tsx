import Link from "next/link";
import type { Listing } from "@/lib/types";
import { formatBedsBaths, formatPrice, formatSqft } from "@/lib/format";
import { FreshnessBadge } from "./FreshnessBadge";
import { TimeBadges } from "./TimeBadges";

/**
 * One ranked result. Horizontal list-card: 1:1 photo slot left (photos are
 * linked from the source at runtime, never rehosted — the skeleton renders
 * a placeholder), meta center, trust signals top-right.
 */
export function ListingCard({
  listing,
  now,
  debug = false,
}: {
  listing: Listing;
  now: Date;
  debug?: boolean;
}) {
  const facts = [
    formatBedsBaths(listing.beds, listing.baths),
    formatSqft(listing.sqft),
    listing.availableDate
      ? `Available ${new Date(listing.availableDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
      : null,
  ].filter(Boolean);

  return (
    <li className="list-none">
      <Link
        href={`/listing/${listing.id}`}
        className="group flex gap-4 rounded-card p-3 transition-shadow hover:shadow-tier"
      >
        <div className="relative flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-surface-strong sm:size-32">
          <span className="px-2 text-center text-[8px] font-bold uppercase tracking-[0.32px] text-muted-soft">
            Photo at source
          </span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
          <div className="flex flex-wrap items-center gap-2">
            {listing.price !== null ? (
              <>
                <span className="text-[20px] font-semibold tracking-[-0.18px] text-ink">
                  {formatPrice(listing.price)}
                </span>
                <span className="text-[14px] text-muted">/mo</span>
              </>
            ) : (
              <span className="rounded-full border border-hairline bg-surface-soft px-2.5 py-0.5 text-[13px] text-muted">
                Price not listed
              </span>
            )}
            {listing.priceIsStartingAt && (
              <span className="rounded-full border border-hairline bg-surface-soft px-2.5 py-0.5 text-[11px] font-semibold text-muted">
                Starting at — units may cost more
              </span>
            )}
            <span className="ml-auto hidden sm:block">
              <FreshnessBadge lastConfirmedAt={listing.lastConfirmedAt} now={now} />
            </span>
          </div>

          {listing.netEffectiveRent !== null && (
            <p className="text-[13px] text-success">
              ≈ {formatPrice(listing.netEffectiveRent)} net effective with
              concessions
            </p>
          )}

          <p className="truncate text-[16px] font-medium text-ink">
            {listing.propertyName}
            <span className="text-muted"> · {listing.neighborhood}</span>
          </p>

          <p className="text-[14px] text-body">{facts.join(" · ")}</p>

          {listing.amenities.length > 0 && (
            <p className="truncate text-[13px] text-muted-soft">
              {listing.amenities.join(" · ")}
            </p>
          )}

          <div className="mt-0.5">
            <TimeBadges
              events={listing.events}
              daysOnMarket={listing.daysOnMarket}
              now={now}
            />
          </div>

          {listing.alsoListedOn.map((also) => (
            <p
              key={also.platform}
              className="text-[13px] text-muted-soft"
            >
              {also.price !== null
                ? `Also listed at ${formatPrice(also.price)}/mo on ${also.platform}`
                : `Also listed on ${also.platform}, price not listed`}
            </p>
          ))}

          <span className="sm:hidden">
            <FreshnessBadge lastConfirmedAt={listing.lastConfirmedAt} now={now} />
          </span>

          {debug && (
            <p className="mt-1 w-fit rounded-[8px] bg-surface-soft px-2 py-1 text-[13px] text-muted">
              relevance {listing.score.textRelevance.toFixed(2)} · freshness{" "}
              {listing.score.freshness.toFixed(2)} · trust{" "}
              {listing.score.trust.toFixed(2)} · proximity{" "}
              {listing.score.proximity.toFixed(2)} → score{" "}
              {listing.score.total.toFixed(2)}
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}
