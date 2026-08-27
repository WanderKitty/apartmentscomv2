import type { ListingEvent } from "@/lib/types";

const fmtDay = (isoAt: string) =>
  new Date(isoAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function timeBadgeLabels(events: ListingEvent[], daysOnMarket: number, now: Date): string[] {
  const out: string[] = [];
  const drops = events.filter((e) => e.kind === "price_drop" && e.fromCents !== null && e.toCents !== null);
  const lastDrop = drops[drops.length - 1];
  if (lastDrop) out.push(`↓$${Math.round((lastDrop.fromCents! - lastDrop.toCents!) / 100).toLocaleString("en-US")} on ${fmtDay(lastDrop.at)}`);
  out.push(`${daysOnMarket} days on market`);
  const lastConcession = events.filter((e) => e.kind === "concession_added").pop();
  if (lastConcession && now.getTime() - new Date(lastConcession.at).getTime() < 7 * 86_400_000) {
    out.push("concession added this week");
  }
  return out;
}

export function TimeBadges({ events, daysOnMarket, now }: { events: ListingEvent[]; daysOnMarket: number; now: Date }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {timeBadgeLabels(events, daysOnMarket, now).map((label) => (
        <span key={label} className="rounded-full bg-surface-soft px-2 py-0.5 text-[12px] text-body">
          {label}
        </span>
      ))}
    </div>
  );
}
