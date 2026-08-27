import { freshnessLabel, freshnessTier } from "@/lib/format";

const DOT: Record<string, string> = {
  fresh: "bg-success",
  aging: "bg-muted-soft",
  stale: "bg-error",
};

/**
 * The "confirmed Xh ago" stamp (spec §6.4) — styled like the reference
 * system's pill badge: white, fully rounded, single shadow tier.
 */
export function FreshnessBadge({
  lastConfirmedAt,
  now,
}: {
  lastConfirmedAt: string;
  now: Date;
}) {
  const tier = freshnessTier(lastConfirmedAt, now);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas px-2.5 py-1 text-[11px] font-semibold text-ink shadow-tier">
      <span className={`size-1.5 rounded-full ${DOT[tier]}`} aria-hidden />
      {freshnessLabel(lastConfirmedAt, now)}
    </span>
  );
}
