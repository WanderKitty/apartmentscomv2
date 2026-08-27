import type { TrueCost } from "@/lib/types";

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/** The concession math shown as arithmetic, not a mystery number. */
export function TrueCostCard({ trueCost }: { trueCost: TrueCost }) {
  return (
    <div className="rounded-card border border-hairline p-4">
      <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted">
        True monthly cost
      </h3>
      <dl className="mt-3 space-y-1.5 text-[15px]">
        <div className="flex items-baseline justify-between">
          <dt className="text-body">Advertised rent</dt>
          <dd className="font-medium text-ink">{usd(trueCost.advertisedMonthly)}/mo</dd>
        </div>
        <div className="flex items-baseline justify-between">
          <dt className="text-body">{trueCost.concessionLabel}</dt>
          <dd className="font-medium text-ink">
            {trueCost.concessionMonthly > 0 ? `−${usd(trueCost.concessionMonthly)}/mo` : "—"}
          </dd>
        </div>
        <div className="flex items-baseline justify-between border-t border-hairline pt-1.5">
          <dt className="font-bold text-ink">Net effective</dt>
          <dd className="font-bold text-ink">{usd(trueCost.netEffectiveMonthly)}/mo</dd>
        </div>
      </dl>
      {trueCost.moveInFees.length > 0 && (
        <dl className="mt-3 space-y-1 border-t border-hairline pt-2 text-[13px] text-muted">
          {trueCost.moveInFees.map((f) => (
            <div key={f.label} className="flex items-baseline justify-between">
              <dt>{f.label}</dt>
              <dd>{usd(f.amount)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
