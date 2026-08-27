import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrueCostCard } from "./TrueCostCard";

const trueCost = {
  advertisedMonthly: 1895,
  concessionLabel: "6 wk free ÷ 13 mo",
  concessionMonthly: 202,
  netEffectiveMonthly: 1693,
  moveInFees: [
    { label: "Application fee", amount: 75 },
    { label: "Admin fee", amount: 250 },
  ],
};

describe("TrueCostCard", () => {
  it("shows the arithmetic: advertised − concession = net effective", () => {
    render(<TrueCostCard trueCost={trueCost} />);
    expect(screen.getByText("$1,895/mo")).toBeInTheDocument();
    expect(screen.getByText("−$202/mo")).toBeInTheDocument();
    expect(screen.getByText("$1,693/mo")).toBeInTheDocument();
    expect(screen.getByText("6 wk free ÷ 13 mo")).toBeInTheDocument();
  });

  it("the displayed numbers are internally consistent", () => {
    expect(trueCost.advertisedMonthly - trueCost.concessionMonthly).toBe(trueCost.netEffectiveMonthly);
  });

  it("lists move-in fees", () => {
    render(<TrueCostCard trueCost={trueCost} />);
    expect(screen.getByText("Application fee")).toBeInTheDocument();
    expect(screen.getByText("$250")).toBeInTheDocument();
  });
});
