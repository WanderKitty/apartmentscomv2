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
  enterIndex,
}: {
  listing: Listing;
  now: Date;
  debug?: boolean;
  /** Position in a freshly-rendered result list; staggers the entrance. */
  enterIndex?: number;
}) {
  const facts = [
    formatBedsBaths(listing.beds, listing.baths),
    formatSqft(listing.sqft),
    listing.availableDate
      ? `Available ${new Date(listing.availableDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
      : null,
  ].filter(Boolean);

  return (
    <li
      className={`list-none${enterIndex !== undefined ? " card-enter" : ""}`}
      style={
        enterIndex !== undefined
          ? ({ "--i": enterIndex } as React.CSSProperties)
          : undefined
      }
    >
      <Link
        href={`/listing/${listing.id}`}
        className="group flex gap-4 rounded-card p-3 transition-shadow duration-[var(--duration-micro)] hover:shadow-tier"
      >
        <div className="relative flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-surface-strong sm:size-32">
          {listing.photoUrl ? (
            // Floorplan diagrams, not photos: contain (never crop labels)
            // on white, matching the diagrams' own background.
            <img
              src={listing.photoUrl}
              alt={`${listing.propertyName} floorplan`}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="img-enter size-full bg-white object-contain p-1.5 transition-transform duration-[var(--duration-micro)] ease-[var(--ease-glide)] group-hover:scale-[1.05]"
            />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-surface-soft to-surface-strong">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-muted-soft"
                aria-hidden
              >
                <path d="M4 21V8l6-4.5L16 8v13" />
                <path d="M16 21V11l4 2.5V21" />
                <path d="M2 21h20" />
                <path d="M8.5 12h1M8.5 16h1" />
              </svg>
              <span className="text-[10px] font-medium text-muted-soft">
                Photo at source
              </span>
            </div>
          )}
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
            {listing.neighborhood && (
              <span className="text-muted"> · {listing.neighborhood}</span>
            )}
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
