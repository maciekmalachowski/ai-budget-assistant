import type { Db } from "@/lib/supabase/admin";
import { parsePeriod, previousMonth } from "@/lib/queries/period";
import { getTransactionsInRange, listTransactions, type TxnListItem } from "@/lib/repos/transactions";
import { totals, spendByCategory } from "@/lib/queries/aggregate";
import { lastNMonths } from "@/lib/format";

export interface DashboardData {
  month: string;
  currency: string;
  spentThisMonthMinor: number;
  spentLastMonthMinor: number;
  topCategory: { category: string; spentMinor: number } | null;
  byCategory: { category: string; spentMinor: number }[];
  trend: { month: string; spentMinor: number }[];
  recent: TxnListItem[];
}

const DEFAULT_CURRENCY = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "PLN";
const TREND_MONTHS = 6;
const RECENT_LIMIT = 8;

/**
 * Assemble everything the dashboard shows for a given "YYYY-MM" month, from the
 * repos + pure aggregators: this/last month spend, top category, the category
 * breakdown (donut), a 6-month spend trend, and the most recent transactions.
 */
export async function getDashboardData(
  db: Db,
  opts: { month: string; accountId?: string; currency?: string },
): Promise<DashboardData> {
  const cur = parsePeriod(opts.month);
  const prev = parsePeriod(previousMonth(opts.month));

  const [curRows, prevRows] = await Promise.all([
    getTransactionsInRange(db, { fromISO: cur.fromISO, toISO: cur.toISO, accountId: opts.accountId }),
    getTransactionsInRange(db, { fromISO: prev.fromISO, toISO: prev.toISO, accountId: opts.accountId }),
  ]);

  const byCategory = spendByCategory(curRows);

  const trend = await Promise.all(
    lastNMonths(opts.month, TREND_MONTHS).map(async (mn) => {
      const b = parsePeriod(mn);
      const rows = await getTransactionsInRange(db, { fromISO: b.fromISO, toISO: b.toISO, accountId: opts.accountId });
      return { month: mn, spentMinor: totals(rows).totalSpentMinor };
    }),
  );

  const recent = await listTransactions(db, { accountId: opts.accountId, limit: RECENT_LIMIT });

  return {
    month: opts.month,
    currency: opts.currency ?? DEFAULT_CURRENCY,
    spentThisMonthMinor: totals(curRows).totalSpentMinor,
    spentLastMonthMinor: totals(prevRows).totalSpentMinor,
    topCategory: byCategory[0] ?? null,
    byCategory,
    trend,
    recent,
  };
}
