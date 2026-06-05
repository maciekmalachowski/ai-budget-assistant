import type { Db } from "@/lib/supabase/admin";
import { parsePeriod, previousMonth, daysInMonth, daysElapsed } from "@/lib/queries/period";
import { getTransactionsInRange, listTransactions, type TxnListItem } from "@/lib/repos/transactions";
import { totals, spendByCategory, pacing, savingsRate } from "@/lib/queries/aggregate";
import { lastNMonths } from "@/lib/format";

export interface TrendPoint {
  month: string;
  /** Spend total (negative). */
  spentMinor: number;
  /** Income total (positive). */
  incomeMinor: number;
  /** income + spent. */
  netMinor: number;
}

export interface DashboardData {
  month: string;
  currency: string;
  spentThisMonthMinor: number;
  spentLastMonthMinor: number;
  incomeThisMonthMinor: number;
  /** income + spent for the month. */
  netThisMonthMinor: number;
  /** Share of income not spent (one decimal), or null when there's no income. */
  savingsRatePct: number | null;
  /** Average spend per elapsed day this month (negative). */
  avgDailySpendMinor: number;
  /** Run-rate projection of the month's total spend (negative). */
  projectedMonthEndMinor: number;
  byCategory: { category: string; spentMinor: number }[];
  trend: TrendPoint[];
  recent: TxnListItem[];
}

const DEFAULT_CURRENCY = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "PLN";
const TREND_MONTHS = 6;
const RECENT_LIMIT = 8;

/**
 * Assemble everything the dashboard shows for a given "YYYY-MM" month, from the
 * repos + pure aggregators: this/last month spend, income & net, savings rate,
 * run-rate pacing, the category breakdown (donut), a 6-month income/spend/net
 * trend, and the most recent transactions. `todayISO` (defaults to now) drives
 * the pacing math and is injectable for deterministic tests.
 */
export async function getDashboardData(
  db: Db,
  opts: { month: string; accountId?: string; currency?: string; todayISO?: string },
): Promise<DashboardData> {
  const cur = parsePeriod(opts.month);
  const prev = parsePeriod(previousMonth(opts.month));

  const [curRows, prevRows] = await Promise.all([
    getTransactionsInRange(db, { fromISO: cur.fromISO, toISO: cur.toISO, accountId: opts.accountId }),
    getTransactionsInRange(db, { fromISO: prev.fromISO, toISO: prev.toISO, accountId: opts.accountId }),
  ]);

  const curTotals = totals(curRows);
  const byCategory = spendByCategory(curRows);

  const trend: TrendPoint[] = await Promise.all(
    lastNMonths(opts.month, TREND_MONTHS).map(async (mn) => {
      const b = parsePeriod(mn);
      const rows = await getTransactionsInRange(db, { fromISO: b.fromISO, toISO: b.toISO, accountId: opts.accountId });
      const t = totals(rows);
      return { month: mn, spentMinor: t.totalSpentMinor, incomeMinor: t.totalIncomeMinor, netMinor: t.netMinor };
    }),
  );

  const recent = await listTransactions(db, { accountId: opts.accountId, limit: RECENT_LIMIT });

  const todayISO = opts.todayISO ?? new Date().toISOString().slice(0, 10);
  const pace = pacing(curTotals.totalSpentMinor, daysElapsed(opts.month, todayISO), daysInMonth(opts.month));

  return {
    month: opts.month,
    currency: opts.currency ?? DEFAULT_CURRENCY,
    spentThisMonthMinor: curTotals.totalSpentMinor,
    spentLastMonthMinor: totals(prevRows).totalSpentMinor,
    incomeThisMonthMinor: curTotals.totalIncomeMinor,
    netThisMonthMinor: curTotals.netMinor,
    savingsRatePct: savingsRate(curTotals.totalIncomeMinor, curTotals.netMinor),
    avgDailySpendMinor: pace.avgDailySpendMinor,
    projectedMonthEndMinor: pace.projectedSpendMinor,
    byCategory,
    trend,
    recent,
  };
}
