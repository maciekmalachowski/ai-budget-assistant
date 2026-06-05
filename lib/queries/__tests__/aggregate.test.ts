import { describe, it, expect } from "vitest";
import { totals, spendByCategory, topMerchants, deltaPct, pacing, savingsRate } from "@/lib/queries/aggregate";
import type { TxnRow } from "@/lib/queries/types";

const rows: TxnRow[] = [
  { amountMinor: -8740, merchant: "BIEDRONKA", currency: "PLN", categoryName: "Groceries" },
  { amountMinor: -2600, merchant: "BIEDRONKA", currency: "PLN", categoryName: "Groceries" },
  { amountMinor: -5000, merchant: "MPK", currency: "PLN", categoryName: "Transport" },
  { amountMinor: -1500, merchant: "ZZZ", currency: "PLN", categoryName: null },
  { amountMinor: 950000, merchant: "EMPLOYER", currency: "PLN", categoryName: "Income" },
];

describe("totals", () => {
  it("separates signed spend from income", () => {
    expect(totals(rows)).toEqual({
      totalSpentMinor: -17840,
      totalIncomeMinor: 950000,
      netMinor: 932160,
    });
  });
});

describe("spendByCategory", () => {
  it("groups expenses by category (uncategorized bucketed), most-spent first, ignoring income", () => {
    expect(spendByCategory(rows)).toEqual([
      { category: "Groceries", spentMinor: -11340 },
      { category: "Transport", spentMinor: -5000 },
      { category: "Uncategorized", spentMinor: -1500 },
    ]);
  });
});

describe("topMerchants", () => {
  it("ranks expense merchants by spend and respects the limit", () => {
    expect(topMerchants(rows, 2)).toEqual([
      { merchant: "BIEDRONKA", spentMinor: -11340 },
      { merchant: "MPK", spentMinor: -5000 },
    ]);
  });
});

describe("deltaPct", () => {
  it("computes percentage change on magnitudes and guards a zero base", () => {
    expect(deltaPct(1000, 1300)).toBe(30);
    expect(deltaPct(1000, 500)).toBe(-50);
    expect(deltaPct(0, 100)).toBeNull();
  });
});

describe("pacing", () => {
  it("projects month-end spend from the run rate", () => {
    // -3000 over 10 of 30 days → -300/day → projected -9000
    expect(pacing(-3000, 10, 30)).toEqual({ avgDailySpendMinor: -300, projectedSpendMinor: -9000 });
  });
  it("returns zeros before any day has elapsed", () => {
    expect(pacing(-3000, 0, 30)).toEqual({ avgDailySpendMinor: 0, projectedSpendMinor: 0 });
  });
});

describe("savingsRate", () => {
  it("is the share of income not spent; negative when overspent; null without income", () => {
    expect(savingsRate(100000, 20000)).toBe(20);
    expect(savingsRate(100000, -5000)).toBe(-5);
    expect(savingsRate(0, 0)).toBeNull();
  });
});
