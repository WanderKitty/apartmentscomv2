"use client";
import Link, { useLinkStatus } from "next/link";
import { ListingDetailSkeleton } from "./ListingDetailSkeleton";

function PendingOverlay() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  // Cover everything below the 80px header with the destination page's
  // skeleton the instant the card is clicked.
  return (
    <div className="fixed inset-x-0 bottom-0 top-20 z-40 overflow-hidden bg-canvas">
      <ListingDetailSkeleton />
    </div>
  );
}

/** A listing-card link that shows the detail skeleton while its navigation is pending. */
export function CardLink({
  href,
  className,
  children,
  ...rest
}: React.ComponentProps<typeof Link>) {
  return (
    <Link href={href} className={className} {...rest}>
      {children}
      <PendingOverlay />
    </Link>
  );
}
