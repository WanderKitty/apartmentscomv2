// True-cost math. A "week free" is one week of rent forgiven: monthly * 12/52.
// The forgiven total is spread evenly over the lease term.

export type Concession =
  | { kind: "free_weeks"; weeks: number; leaseMonths: number }
  | { kind: "free_months"; months: number; leaseMonths: number }
  | { kind: "flat_discount"; valueCents: number; leaseMonths: number };

export function netEffectiveMonthlyCents(input: {
  advertisedCents: number;
  concession: Concession | null;
}): number {
  const { advertisedCents, concession } = input;
  if (!concession) return advertisedCents;
  let discountTotalCents: number;
  switch (concession.kind) {
    case "free_weeks":
      discountTotalCents = advertisedCents * concession.weeks * (12 / 52);
      break;
    case "free_months":
      discountTotalCents = advertisedCents * concession.months;
      break;
    case "flat_discount":
      discountTotalCents = concession.valueCents;
      break;
  }
  return Math.round(
    advertisedCents - discountTotalCents / concession.leaseMonths,
  );
}
