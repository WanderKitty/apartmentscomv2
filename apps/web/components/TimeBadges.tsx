import type { ListingEvent } from "@/lib/types";

const fmtDay = (isoAt: string) =>
  new Date(isoAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function timeBadgeLabels(events: ListingEvent[], daysOnMarket: number, now: Date): string[] {
  const out: string[] = [];
  const drops = events.filter((e) => e.kind === "price_drop" && e.fromCents !== null && e.toCents !== null);
  const lastDrop = drops[drops.length - 1];
  if (lastDrop) out.push(`↓$${Math.round((lastDrop.fromCents! - lastDrop.toCents!) / 100).toLocaleString("en-US")} on ${fmtDay(lastDrop.at)}`);
  // Day 0 = we just found it; a corpus-wide wall of "0 days on market"
  // reads like a bug, while "New" is the signal renters actually want.
  if (daysOnMarket === 0) out.push("New");
  else out.push(`${daysOnMarket} ${daysOnMarket === 1 ? "day" : "days"} on market`);
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
        <span
          key={label}
          className={
            label === "New"
              ? "rounded-full bg-rausch-disabled/40 px-2 py-0.5 text-[12px] font-semibold text-rausch-active"
              : "rounded-full bg-surface-soft px-2 py-0.5 text-[12px] text-body"
          }
        >
          {label}
        </span>
      ))}
    </div>
  );
}
