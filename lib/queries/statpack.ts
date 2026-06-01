import type { TxnRow } from "@/lib/queries/types";
import type { InsightStatPack } from "@/lib/ai/insights";
import { totals, spendByCategory, topMerchants, deltaPct } from "@/lib/queries/aggregate";

/**
 * Build the compact stat pack handed to the insights model from the current
 * period's rows and the previous period's rows (for deltas / new merchants).
 * Pure: no DB, no I/O. Income is excluded from category/merchant breakdowns by
 * the aggregators (they only sum negative amounts).
 */
export function buildStatPack(input: {
  periodLabel: string;
  currency: string;
  current: TxnRow[];
  previous: TxnRow[];
}): InsightStatPack {
  const cur = totals(input.current);
  const byCategory = spendByCategory(input.current);

  const prevByCategory = new Map(
    spendByCategory(input.previous).map((c) => [c.category, c.spentMinor]),
  );
  const vsPrevious = byCategory
    .map((c) => {
      const prev = prevByCategory.get(c.category);
      if (prev === undefined) return null;
      const pct = deltaPct(Math.abs(prev), Math.abs(c.spentMinor));
      return pct === null ? null : { category: c.category, deltaPct: pct };
    })
    .filter((x): x is { category: string; deltaPct: number } => x !== null);

  const prevMerchants = new Set(
    input.previous.filter((r) => r.amountMinor < 0).map((r) => r.merchant ?? "Unknown"),
  );
  const newMerchants = [
    ...new Set(
      input.current.filter((r) => r.amountMinor < 0).map((r) => r.merchant ?? "Unknown"),
    ),
  ].filter((m) => !prevMerchants.has(m));

  return {
    periodLabel: input.periodLabel,
    currency: input.currency,
    totalSpentMinor: cur.totalSpentMinor,
    totalIncomeMinor: cur.totalIncomeMinor,
    byCategory: byCategory.map((c) => ({ category: c.category, spentMinor: c.spentMinor })),
    vsPrevious,
    topMerchants: topMerchants(input.current, 5),
    newMerchants,
  };
}
