import type { TxnRow } from "@/lib/queries/types";

export interface Totals {
  /** Sum of negative amounts (stays negative). */
  totalSpentMinor: number;
  /** Sum of positive amounts. */
  totalIncomeMinor: number;
  /** spent + income. */
  netMinor: number;
}

export function totals(rows: TxnRow[]): Totals {
  let spent = 0;
  let income = 0;
  for (const r of rows) {
    if (r.amountMinor < 0) spent += r.amountMinor;
    else income += r.amountMinor;
  }
  return { totalSpentMinor: spent, totalIncomeMinor: income, netMinor: spent + income };
}

export interface CategorySpend {
  category: string;
  spentMinor: number;
}

/** Expense (negative) totals grouped by category; uncategorized → "Uncategorized". Most-spent (most negative) first. */
export function spendByCategory(rows: TxnRow[]): CategorySpend[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.amountMinor >= 0) continue;
    const key = r.categoryName ?? "Uncategorized";
    map.set(key, (map.get(key) ?? 0) + r.amountMinor);
  }
  return [...map.entries()]
    .map(([category, spentMinor]) => ({ category, spentMinor }))
    .sort((a, b) => a.spentMinor - b.spentMinor);
}

export interface MerchantSpend {
  merchant: string;
  spentMinor: number;
}

/** Top expense merchants by spend; unknown merchant → "Unknown". */
export function topMerchants(rows: TxnRow[], limit = 5): MerchantSpend[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.amountMinor >= 0) continue;
    const key = r.merchant ?? "Unknown";
    map.set(key, (map.get(key) ?? 0) + r.amountMinor);
  }
  return [...map.entries()]
    .map(([merchant, spentMinor]) => ({ merchant, spentMinor }))
    .sort((a, b) => a.spentMinor - b.spentMinor)
    .slice(0, Math.max(0, limit));
}

/**
 * Percentage change from `from` to `to`, rounded to one decimal. Pass magnitudes
 * (non-negative) so "spending up 30%" reads as +30. Returns null when `from` is 0
 * (undefined change).
 */
export function deltaPct(from: number, to: number): number | null {
  if (from === 0) return null;
  return Math.round(((to - from) / Math.abs(from)) * 1000) / 10;
}

export interface Pacing {
  /** Average spend per elapsed day (negative, like stored spend). */
  avgDailySpendMinor: number;
  /** Run-rate projection of the full month's spend (negative). */
  projectedSpendMinor: number;
}

/**
 * Run-rate pacing for a month. `totalSpentMinor` is negative (sum of outflows).
 * avgDaily = totalSpent / daysElapsed; projected = avgDaily × daysInMonth.
 * Returns zeros before any day has elapsed. Pure — caller supplies the day counts.
 */
export function pacing(totalSpentMinor: number, daysElapsed: number, daysInMonth: number): Pacing {
  if (daysElapsed <= 0) return { avgDailySpendMinor: 0, projectedSpendMinor: 0 };
  const avg = totalSpentMinor / daysElapsed;
  // Both round from the same unrounded `avg`. Rounding the projection once (rather than
  // avgRounded × daysInMonth) keeps a COMPLETED month — daysElapsed === daysInMonth —
  // projecting to exactly its actual spend; avgDailySpendMinor is an independent rounded
  // display of the same rate, so avg × days may differ by sub-unit rounding. Intentional.
  return {
    avgDailySpendMinor: Math.round(avg),
    projectedSpendMinor: Math.round(avg * daysInMonth),
  };
}

/**
 * Savings rate: the share of income that was NOT spent, as a percent rounded to one
 * decimal. `netMinor` = income + spent (spent is negative). Returns null when there is
 * no income (undefined); may be negative when the month overspent its income.
 */
export function savingsRate(totalIncomeMinor: number, netMinor: number): number | null {
  if (totalIncomeMinor <= 0) return null;
  return Math.round((netMinor / totalIncomeMinor) * 1000) / 10;
}
