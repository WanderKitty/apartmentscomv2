"use client";
import Link, { useLinkStatus } from "next/link";

function PendingDot() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      className="spinner shrink-0"
      aria-hidden
    >
      <path d="M12 2.5 A9.5 9.5 0 1 1 2.5 12" />
    </svg>
  );
}

/** A query chip that shows a small spinner while its navigation is pending. */
export function ChipLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-[13px] text-body transition-colors hover:border-border-strong"
    >
      {children}
      <PendingDot />
    </Link>
  );
}
