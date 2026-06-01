import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/lib/supabase/admin";
import { parsePeriod, previousMonth } from "@/lib/queries/period";
import { getTransactionsInRange } from "@/lib/repos/transactions";
import { buildStatPack } from "@/lib/queries/statpack";
import { generateInsight } from "@/lib/ai/insights";
import { getCachedInsight, upsertInsight } from "@/lib/repos/insights";

export interface InsightResult {
  period: string;
  summaryMd: string;
  stats: unknown;
  cached: boolean;
}

const DEFAULT_CURRENCY = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "PLN";

/**
 * Return the cached monthly insight for a "YYYY-MM" period, generating + caching
 * it on a miss or when the cache is marked stale. Builds a compact stat pack
 * (current month vs previous month) and asks the model for a short narrative.
 */
export async function getOrGenerateInsight(
  deps: { db: Db; anthropic: Anthropic },
  input: { period: string; currency?: string },
): Promise<InsightResult> {
  const { db, anthropic } = deps;
  const { fromISO, toISO, label } = parsePeriod(input.period);
  const periodStart = fromISO;

  const cached = await getCachedInsight(db, "month", periodStart);
  if (cached && !cached.stale && cached.summaryMd) {
    return { period: input.period, summaryMd: cached.summaryMd, stats: cached.stats, cached: true };
  }

  const current = await getTransactionsInRange(db, { fromISO, toISO });
  const prev = parsePeriod(previousMonth(input.period));
  const previous = await getTransactionsInRange(db, { fromISO: prev.fromISO, toISO: prev.toISO });

  const statPack = buildStatPack({
    periodLabel: label,
    currency: input.currency ?? DEFAULT_CURRENCY,
    current,
    previous,
  });
  const summaryMd = await generateInsight(anthropic, statPack);
  await upsertInsight(db, { periodType: "month", periodStart, summaryMd, stats: statPack });

  return { period: input.period, summaryMd, stats: statPack, cached: false };
}
