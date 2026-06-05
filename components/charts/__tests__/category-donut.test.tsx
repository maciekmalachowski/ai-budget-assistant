import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CategoryDonut } from "@/components/charts/category-donut";

// Chart.js renders to <canvas>, which jsdom doesn't implement — stub the chart so we can
// assert the surrounding markup (empty state + the color legend) without a real canvas.
vi.mock("react-chartjs-2", () => ({ Doughnut: () => null, Chart: () => null }));

describe("CategoryDonut", () => {
  it("renders an empty state when there is no spending", () => {
    render(<CategoryDonut data={[]} currency="USD" />);
    expect(screen.getByText(/no spending this month/i)).toBeInTheDocument();
  });

  it("lists each category with its formatted spend in the legend", () => {
    render(
      <CategoryDonut
        data={[
          { category: "Groceries", spentMinor: -13000 },
          { category: "Transport", spentMinor: -5000 },
        ]}
        currency="USD"
      />,
    );
    expect(screen.getByText("Groceries")).toBeInTheDocument();
    expect(screen.getByText("Transport")).toBeInTheDocument();
    // Locale-tolerant (component uses the default pl-PL locale → "130,00 USD"): match the digits.
    expect(screen.getByText(/130[.,]00/)).toBeInTheDocument();
    expect(screen.getByText(/50[.,]00/)).toBeInTheDocument();
  });
});
