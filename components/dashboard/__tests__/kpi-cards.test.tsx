import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiCards } from "@/components/dashboard/kpi-cards";

describe("KpiCards", () => {
  it("shows spend, vs-last-month delta, net saved + savings rate, and the projection", () => {
    render(
      <KpiCards
        spentThisMonthMinor={-130000}
        spentLastMonthMinor={-100000}
        netThisMonthMinor={70000}
        savingsRatePct={35}
        projectedMonthEndMinor={-180000}
        avgDailySpendMinor={-6000}
        currency="USD"
        locale="en-US"
      />,
    );
    expect(screen.getByText("Spent this month")).toBeInTheDocument();
    expect(screen.getByText("$1,300.00")).toBeInTheDocument(); // magnitude shown
    expect(screen.getByText(/30(\.0)?%/)).toBeInTheDocument(); // 1000 → 1300 = +30%
    expect(screen.getByText("Net saved")).toBeInTheDocument();
    expect(screen.getByText("$700.00")).toBeInTheDocument();
    expect(screen.getByText(/35% of income/)).toBeInTheDocument();
    expect(screen.getByText("Projected month-end")).toBeInTheDocument();
    expect(screen.getByText("$1,800.00")).toBeInTheDocument();
    expect(screen.getByText(/\$60\.00\/day avg/)).toBeInTheDocument();
    // The Top Category tile was removed.
    expect(screen.queryByText(/top category/i)).not.toBeInTheDocument();
  });

  it("labels a negative net as overspent and copes with no income / no prior month", () => {
    render(
      <KpiCards
        spentThisMonthMinor={-5000}
        spentLastMonthMinor={0}
        netThisMonthMinor={-5000}
        savingsRatePct={null}
        projectedMonthEndMinor={-5000}
        avgDailySpendMinor={-200}
        currency="USD"
        locale="en-US"
      />,
    );
    expect(screen.getByText("Net overspent")).toBeInTheDocument();
    expect(screen.getByText(/no income yet/)).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument(); // vs-last-month with a zero base
  });
});
