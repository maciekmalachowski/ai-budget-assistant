import { describe, it, expect } from "vitest";
import { buildStatPack } from "@/lib/queries/statpack";
import type { TxnRow } from "@/lib/queries/types";

const current: TxnRow[] = [
  { amountMinor: -13000, merchant: "BIEDRONKA", currency: "PLN", categoryName: "Groceries" },
  { amountMinor: -5000, merchant: "MPK", currency: "PLN", categoryName: "Transport" },
  { amountMinor: -2000, merchant: "NETFLIX", currency: "PLN", categoryName: "Subscriptions" },
  { amountMinor: 950000, merchant: "EMPLOYER", currency: "PLN", categoryName: "Income" },
];
const previous: TxnRow[] = [
  { amountMinor: -10000, merchant: "BIEDRONKA", currency: "PLN", categoryName: "Groceries" },
  { amountMinor: -5000, merchant: "MPK", currency: "PLN", categoryName: "Transport" },
];

describe("buildStatPack", () => {
  it("assembles totals, category breakdown, period deltas, top merchants, and new merchants", () => {
    const pack = buildStatPack({ periodLabel: "May 2026", currency: "PLN", current, previous });

    expect(pack.periodLabel).toBe("May 2026");
    expect(pack.currency).toBe("PLN");
    expect(pack.totalSpentMinor).toBe(-20000);
    expect(pack.totalIncomeMinor).toBe(950000);
    expect(pack.byCategory).toEqual([
      { category: "Groceries", spentMinor: -13000 },
      { category: "Transport", spentMinor: -5000 },
      { category: "Subscriptions", spentMinor: -2000 },
    ]);
    // Groceries 10000 -> 13000 = +30%; Transport unchanged = 0%; Subscriptions absent in previous -> omitted.
    expect(pack.vsPrevious).toEqual([
      { category: "Groceries", deltaPct: 30 },
      { category: "Transport", deltaPct: 0 },
    ]);
    expect(pack.topMerchants[0]).toEqual({ merchant: "BIEDRONKA", spentMinor: -13000 });
    expect(pack.newMerchants).toEqual(["NETFLIX"]);
  });

  it("excludes income merchants and categories from spend-only breakdowns", () => {
    const pack = buildStatPack({
      periodLabel: "May 2026",
      currency: "PLN",
      // GIFT is a brand-new income merchant in the current period (absent from previous).
      current: [
        { amountMinor: -3000, merchant: "BIEDRONKA", currency: "PLN", categoryName: "Groceries" },
        { amountMinor: 12000, merchant: "GIFT", currency: "PLN", categoryName: "Income" },
      ],
      previous: [
        { amountMinor: -3000, merchant: "BIEDRONKA", currency: "PLN", categoryName: "Groceries" },
      ],
    });
    // A new *income* merchant must not surface as a "new merchant" (spend-only).
    expect(pack.newMerchants).toEqual([]);
    // Income categories/merchants must not appear in the spend breakdowns.
    expect(pack.byCategory.some((c) => c.category === "Income")).toBe(false);
    expect(pack.topMerchants.some((m) => m.merchant === "GIFT")).toBe(false);
  });
});
