import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiCards } from "@/components/dashboard/kpi-cards";

describe("KpiCards", () => {
  it("shows this-month spend, the vs-last-month delta, and the top category", () => {
    render(
      <KpiCards
        spentThisMonthMinor={-130000}
        spentLastMonthMinor={-100000}
        topCategory={{ category: "Groceries", spentMinor: -121000 }}
        currency="USD"
        locale="en-US"
      />,
    );
    expect(screen.getByText("Spent this month")).toBeInTheDocument();
    expect(screen.getByText("$1,300.00")).toBeInTheDocument(); // magnitude shown
    expect(screen.getByText("Groceries")).toBeInTheDocument();
    expect(screen.getByText(/30(\.0)?%/)).toBeInTheDocument(); // 1000 → 1300 = +30%
  });

  it("handles no spending and no top category", () => {
    render(<KpiCards spentThisMonthMinor={0} spentLastMonthMinor={0} topCategory={null} currency="USD" locale="en-US" />);
    // Both the vs-last-month delta (null base) and the top-category card render an em dash.
    expect(screen.getAllByText("—")).toHaveLength(2);
  });
});
