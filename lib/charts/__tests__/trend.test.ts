import { describe, it, expect } from "vitest";
import { buildTrendModel } from "@/lib/charts/trend";

describe("buildTrendModel", () => {
  it("splits income, spend magnitude, and signed net with short month labels", () => {
    const m = buildTrendModel([
      { month: "2026-04", spentMinor: -9000, incomeMinor: 0, netMinor: -9000 },
      { month: "2026-05", spentMinor: -18000, incomeMinor: 950000, netMinor: 932000 },
    ]);
    expect(m.labels).toEqual(["Apr", "May"]);
    expect(m.income).toEqual([0, 950000]);
    expect(m.spend).toEqual([9000, 18000]); // positive magnitudes
    expect(m.net).toEqual([-9000, 932000]); // signed
  });

  it("handles an empty trend", () => {
    expect(buildTrendModel([])).toEqual({ labels: [], income: [], spend: [], net: [] });
  });
});
