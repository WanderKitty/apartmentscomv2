import { getPool } from "@aptv2/db";
import { getSourceHealth } from "@/lib/admin";
import { relativeTime } from "@/lib/format";
import type { SourceHealth } from "@/lib/types";

// Relative "last scrape" times must reflect request time, not build time.
export const dynamic = "force-dynamic";

const HOUR = 3_600_000;

type Health = "ok" | "warning" | "failing" | "disabled";

function health(s: SourceHealth, now: Date): Health {
  if (!s.enabled) return "disabled";
  const age = s.lastScrapedAt
    ? now.getTime() - new Date(s.lastScrapedAt).getTime()
    : Infinity;
  // Alert thresholds per spec §8: source failing 48h, listing count drop >20%/day.
  if (s.failureStreak >= 3 || age > 48 * HOUR) return "failing";
  if (s.failureStreak > 0 || age > 24 * HOUR) return "warning";
  return "ok";
}

const HEALTH_STYLE: Record<Health, string> = {
  ok: "text-success",
  warning: "text-muted",
  failing: "text-error",
  disabled: "text-muted-soft",
};

const HEALTH_LABEL: Record<Health, string> = {
  ok: "OK",
  warning: "Watch",
  failing: "Failing",
  disabled: "Disabled",
};

export default async function AdminPage() {
  const now = new Date();
  const sources = await getSourceHealth(getPool());
  const active = sources.reduce((n, s) => n + s.activeListings, 0);
  const alerts = sources.filter((s) => health(s, now) === "failing").length;

  return (
    <div className="mx-auto w-full max-w-[1080px] px-6 pb-16 pt-8">
      <h1 className="text-[22px] font-medium tracking-[-0.44px] text-ink">
        Scrape health
      </h1>
      <p className="mt-1 text-[14px] text-muted">
        {sources.length} sources · {active} active listings ·{" "}
        <span className={alerts > 0 ? "font-medium text-error" : ""}>
          {alerts} {alerts === 1 ? "alert" : "alerts"}
        </span>
      </p>

      <div className="mt-6 overflow-x-auto rounded-card border border-hairline">
        <table className="w-full min-w-[720px] text-left text-[14px]">
          <thead>
            <tr className="border-b border-hairline bg-surface-soft text-[12px] font-bold text-muted">
              <th className="px-4 py-3 font-bold">Source</th>
              <th className="px-4 py-3 font-bold">Platform</th>
              <th className="px-4 py-3 font-bold">Status</th>
              <th className="px-4 py-3 font-bold">Last scrape</th>
              <th className="px-4 py-3 text-right font-bold">Fail streak</th>
              <th className="px-4 py-3 text-right font-bold">Active</th>
              <th className="px-4 py-3 text-right font-bold">Δ 24h</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => {
              const h = health(s, now);
              const dropRatio =
                s.activeListings > 0
                  ? s.listingDelta24h / (s.activeListings - s.listingDelta24h)
                  : 0;
              const bigDrop = dropRatio < -0.2;
              return (
                <tr
                  key={s.id}
                  className="border-b border-hairline-soft last:border-b-0"
                >
                  <td className="px-4 py-3 font-medium text-ink">{s.name}</td>
                  <td className="px-4 py-3 text-muted">{s.platform}</td>
                  <td
                    className={`px-4 py-3 font-semibold ${HEALTH_STYLE[h]}`}
                  >
                    {HEALTH_LABEL[h]}
                  </td>
                  <td className="px-4 py-3 text-body">
                    {s.lastScrapedAt
                      ? relativeTime(s.lastScrapedAt, now)
                      : "never"}
                  </td>
                  <td
                    className={`px-4 py-3 text-right ${
                      s.failureStreak >= 3 ? "font-semibold text-error" : "text-body"
                    }`}
                  >
                    {s.failureStreak}
                  </td>
                  <td className="px-4 py-3 text-right text-body">
                    {s.activeListings}
                  </td>
                  <td
                    className={`px-4 py-3 text-right ${
                      bigDrop ? "font-semibold text-error" : "text-body"
                    }`}
                  >
                    {s.listingDelta24h > 0 ? "+" : ""}
                    {s.listingDelta24h}
                    {bigDrop && " ⚠ adapter?"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[13px] text-muted-soft">
        Failing = 3+ consecutive failures or no successful scrape in 48h. A
        &gt;20% one-day drop in listings usually means the adapter broke, not
        the market.
      </p>
    </div>
  );
}
