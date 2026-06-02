import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InsightsView } from "@/components/insights/insights-view";

const RESPONSE = {
  period: "2026-06",
  summaryMd: "You spent **a bit less** this month.",
  cached: false,
  stats: {
    periodLabel: "June 2026",
    currency: "PLN",
    totalSpentMinor: -120000,
    totalIncomeMinor: 500000,
    byCategory: [{ category: "Groceries", spentMinor: -80000 }],
    vsPrevious: [{ category: "Groceries", deltaPct: -12 }],
    topMerchants: [{ merchant: "BIEDRONKA", spentMinor: -50000 }],
    newMerchants: ["NETFLIX"],
  },
};

describe("InsightsView", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("generates on demand and renders the summary + supporting numbers", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => RESPONSE });
    render(<InsightsView months={["2026-06", "2026-05"]} defaultPeriod="2026-06" />);

    expect(screen.queryByText(/a bit less/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));

    await waitFor(() => expect(screen.getByText("a bit less").tagName).toBe("STRONG"));
    expect(screen.getByText("BIEDRONKA")).toBeInTheDocument();
    expect(screen.getByText("NETFLIX")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/insights?period=2026-06");
  });

  it("shows an error when generation fails", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Could not generate insights for that period." }),
    });
    render(<InsightsView months={["2026-06"]} defaultPeriod="2026-06" />);
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    await waitFor(() =>
      expect(screen.getByText("Could not generate insights for that period.")).toBeInTheDocument(),
    );
  });
});
