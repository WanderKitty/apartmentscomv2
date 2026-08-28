import Link from "next/link";
import type { Listing } from "@/lib/types";
import { formatBedsBaths, formatPrice, formatSqft } from "@/lib/format";
import { FreshnessBadge } from "./FreshnessBadge";
import { TimeBadges } from "./TimeBadges";

/**
 * One ranked result, as the reference system's photo-first property card:
 * a 1:1 photo plate with rounded-md clipping (floorplans hotlinked from
 * the source, never rehosted), the freshness stamp floating top-left the
 * way the doc floats "Guest favorite", a NEW tag top-right, then meta
 * lines beneath — title/price row first, quieter lines after.
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
  ].filter(Boolean);
  const metaLine = `${listing.neighborhood ? `${listing.neighborhood} · ` : ""}${facts.join(" · ")}`;

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
        data-testid="listing-card"
        className="group block"
      >
        {/* Photo plate */}
        {/* Floorplan diagrams are white-on-white — the hairline keeps the
            photo plate's bounds legible, unlike photography which self-bounds. */}
        <div className="relative aspect-square overflow-hidden rounded-card border border-hairline-soft bg-surface-strong">
          {listing.photoUrl ? (
            // Floorplan diagrams, not photos: contain (never crop labels)
            // on white, matching the diagrams' own background.
            <img
              src={listing.photoUrl}
              alt={`${listing.propertyName} floorplan`}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="img-enter size-full bg-white object-contain p-4 transition-transform duration-[var(--duration-micro)] ease-[var(--ease-glide)] group-hover:scale-[1.04]"
            />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-surface-soft to-surface-strong">
              <svg
                width="32"
                height="32"
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

          {/* Floating trust badge, guest-favorite position (top-left). */}
          <span className="absolute left-3 top-3">
            <FreshnessBadge
              lastConfirmedAt={listing.lastConfirmedAt}
              now={now}
            />
          </span>

          {/* new-tag per the doc: tiny white pill, 8px/700 uppercase. */}
          {listing.daysOnMarket === 0 && (
            <span className="absolute right-3 top-3 rounded-full bg-canvas px-2 py-1 text-[8px] font-bold uppercase tracking-[0.32px] text-ink shadow-tier">
              New
            </span>
          )}
        </div>

        {/* Meta block */}
        <div className="mt-3 flex flex-col gap-0.5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-[16px] font-semibold leading-[1.25] text-ink">
              {listing.propertyName}
            </p>
            {listing.price !== null ? (
              <p className="shrink-0 text-[16px] font-semibold leading-[1.25] text-ink">
                {formatPrice(listing.price)}
                <span className="text-[13px] font-normal text-muted"> /mo</span>
              </p>
            ) : (
              <p className="shrink-0 text-[13px] text-muted">Price not listed</p>
            )}
          </div>

          {/* title carries the full text past any grid-width truncation. */}
          <p className="truncate text-[14px] leading-[1.43] text-muted" title={metaLine}>
            {metaLine}
          </p>

          {/* Availability gets its own row — folded into the truncating
              line above it was the first thing ellipsized on grid cells. */}
          {listing.availableDate && (
            <p className="text-[13px] leading-[1.23] text-muted">
              Available{" "}
              {new Date(listing.availableDate + "T00:00:00").toLocaleDateString(
                "en-US",
                { month: "short", day: "numeric" },
              )}
            </p>
          )}

          {listing.priceIsStartingAt && (
            <p className="text-[13px] leading-[1.23] text-muted">
              “Starting at” — units may cost more
            </p>
          )}

          {listing.netEffectiveRent !== null && (
            <p className="text-[13px] leading-[1.23] text-success">
              ≈ {formatPrice(listing.netEffectiveRent)} net effective with
              concessions
            </p>
          )}

          {listing.amenities.length > 0 && (
            <p className="truncate text-[13px] leading-[1.23] text-muted-soft">
              {listing.amenities.join(" · ")}
            </p>
          )}

          <div className="mt-1">
            <TimeBadges
              events={listing.events}
              daysOnMarket={listing.daysOnMarket}
              now={now}
              showNew={false}
            />
          </div>

          {listing.alsoListedOn.map((also) => (
            <p key={also.platform} className="text-[13px] text-muted-soft">
              {also.price !== null
                ? `Also listed at ${formatPrice(also.price)}/mo on ${also.platform}`
                : `Also listed on ${also.platform}, price not listed`}
            </p>
          ))}

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
