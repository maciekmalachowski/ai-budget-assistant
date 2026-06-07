import { z } from "zod";
import type { Db } from "@/lib/supabase/admin";
import type { QueryTools } from "@/lib/ai/tools";
import { parsePeriod } from "@/lib/queries/period";
import { totals, spendByCategory, topMerchants, deltaPct } from "@/lib/queries/aggregate";
import { getTransactionsInRange, listTransactions } from "@/lib/repos/transactions";

const totalsSchema = z.object({
  period: z.string(),
  kind: z.enum(["expense", "income"]).optional(),
  accountId: z.string().optional(),
});
const periodSchema = z.object({ period: z.string(), accountId: z.string().optional() });
const compareSchema = z.object({ metric: z.string(), periodA: z.string(), periodB: z.string() });
const topMerchantsSchema = z.object({
  period: z.string(),
  limit: z.number().int().positive().max(50).optional(),
});
const listSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  category: z.string().optional(),
  merchant: z.string().optional(),
  minAmountMinor: z.number().optional(),
  maxAmountMinor: z.number().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

/**
 * Real, DB-backed implementations of the read-only Q&A tools. Each validates its
 * input with Zod (throws on bad input — the Q&A loop captures that into the
 * tool_result), runs a parameterized read via the repos, and returns plain
 * JSON-serializable data (amounts are signed integer minor units). Never writes.
 */
export function createQueryTools(db: Db): QueryTools {
  return {
    totals: async (input) => {
      const { period, kind, accountId } = totalsSchema.parse(input);
      const { fromISO, toISO } = parsePeriod(period);
      const rows = await getTransactionsInRange(db, { fromISO, toISO, accountId });
      const t = totals(rows);
      if (kind === "expense") return { totalSpentMinor: t.totalSpentMinor };
      if (kind === "income") return { totalIncomeMinor: t.totalIncomeMinor };
      return t;
    },

    spend_by_category: async (input) => {
      const { period, accountId } = periodSchema.parse(input);
      const { fromISO, toISO } = parsePeriod(period);
      const rows = await getTransactionsInRange(db, { fromISO, toISO, accountId });
      return spendByCategory(rows);
    },

    compare_periods: async (input) => {
      const { metric, periodA, periodB } = compareSchema.parse(input);
      const a = parsePeriod(periodA);
      const b = parsePeriod(periodB);
      const rowsA = await getTransactionsInRange(db, { fromISO: a.fromISO, toISO: a.toISO });
      const rowsB = await getTransactionsInRange(db, { fromISO: b.fromISO, toISO: b.toISO });

      const valueFor = (rows: Awaited<ReturnType<typeof getTransactionsInRange>>): number => {
        const lower = metric.toLowerCase();
        if (lower === "income" || lower === "total_income") return totals(rows).totalIncomeMinor;
        if (lower === "expense" || lower === "total_expense") return totals(rows).totalSpentMinor;
        const cat = spendByCategory(rows).find((c) => c.category.toLowerCase() === lower);
        return cat ? cat.spentMinor : 0;
      };
      const valueA = valueFor(rowsA);
      const valueB = valueFor(rowsB);
      return { metric, periodA, periodB, valueA, valueB, deltaPct: deltaPct(Math.abs(valueA), Math.abs(valueB)) };
    },

    top_merchants: async (input) => {
      const { period, limit } = topMerchantsSchema.parse(input);
      const { fromISO, toISO } = parsePeriod(period);
      const rows = await getTransactionsInRange(db, { fromISO, toISO });
      return topMerchants(rows, limit ?? 5);
    },

    list_transactions: async (input) => {
      const f = listSchema.parse(input);
      return listTransactions(db, {
        fromISO: f.from,
        toISO: f.to,
        category: f.category,
        merchant: f.merchant,
        minAmountMinor: f.minAmountMinor,
        maxAmountMinor: f.maxAmountMinor,
        limit: f.limit,
      });
    },
  };
}

/**
 * Wrap a primary tool set so that any tool whose *infrastructure* fails (e.g. the
 * `readonly_qa` JWT is rejected by PostgREST, or its role/policies aren't on the DB)
 * transparently retries on a `fallback` tool set, logging the real error once. Zod
 * validation errors are NOT retried — they flow back to the model so it can fix its
 * arguments. This keeps the hardened readonly read path when the env is correct, but
 * never breaks Q&A when it isn't (the query tools only ever SELECT either way).
 */
export function withReadonlyFallback(
  primary: QueryTools,
  fallback: QueryTools,
  log: (info: { tool: string; error: string }) => void = () => {},
): QueryTools {
  const p = primary as unknown as Record<string, (i: unknown) => Promise<unknown>>;
  const f = fallback as unknown as Record<string, (i: unknown) => Promise<unknown>>;
  const out: Record<string, (i: unknown) => Promise<unknown>> = {};
  for (const name of Object.keys(p)) {
    // Fail loud at construction if the shapes diverge, rather than a confusing
    // "f[name] is not a function" buried in the fallback path at request time.
    if (typeof f[name] !== "function") {
      throw new Error(`withReadonlyFallback: fallback is missing tool "${name}"`);
    }
    out[name] = async (input) => {
      let primaryErr: unknown;
      try {
        return await p[name](input);
      } catch (err) {
        if (err instanceof z.ZodError) throw err; // bad args → let the model correct them
        primaryErr = err;
        log({ tool: name, error: err instanceof Error ? err.message : String(err) });
      }
      try {
        return await f[name](input);
      } catch {
        throw primaryErr; // both paths failed → surface the original readonly cause, not the fallback's
      }
    };
  }
  return out as unknown as QueryTools;
}
