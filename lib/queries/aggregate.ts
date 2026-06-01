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
