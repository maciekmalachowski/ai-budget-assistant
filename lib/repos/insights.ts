import type { Db } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

export interface CachedInsight {
  id: string;
  summaryMd: string | null;
  stats: unknown;
  stale: boolean;
}

/** The cached insight for a period, or null if none exists. */
export async function getCachedInsight(
  db: Db,
  periodType: "month" | "week",
  periodStart: string,
): Promise<CachedInsight | null> {
  const { data, error } = await db
    .from("insights")
    .select("id, summary_md, stats, stale")
    .eq("period_type", periodType)
    .eq("period_start", periodStart)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { id: data.id, summaryMd: data.summary_md, stats: data.stats, stale: data.stale };
}

/**
 * Store (or refresh) the cached insight for a period and mark it fresh.
 * (insights has no unique constraint on (period_type, period_start), so this is
 * find-then-update/insert.) Returns the insight id.
 */
export async function upsertInsight(
  db: Db,
  input: { periodType: "month" | "week"; periodStart: string; summaryMd: string; stats: unknown },
): Promise<string> {
  const existing = await getCachedInsight(db, input.periodType, input.periodStart);
  if (existing) {
    const { error } = await db
      .from("insights")
      .update({
        summary_md: input.summaryMd,
        stats: input.stats as Json,
        stale: false,
        generated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return existing.id;
  }
  const { data, error } = await db
    .from("insights")
    .insert({
      period_type: input.periodType,
      period_start: input.periodStart,
      summary_md: input.summaryMd,
      stats: input.stats as Json,
      stale: false,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

/** Mark a period's cached insight stale (e.g. after new transactions land in it). No-op if none cached. */
export async function markPeriodStale(
  db: Db,
  periodType: "month" | "week",
  periodStart: string,
): Promise<void> {
  const { error } = await db
    .from("insights")
    .update({ stale: true })
    .eq("period_type", periodType)
    .eq("period_start", periodStart);
  if (error) throw new Error(error.message);
}

/**
 * Mark the cached monthly insight stale for each distinct "YYYY-MM" month — call
 * whenever transactions in those months change (import, recategorize, delete) so the
 * next read regenerates instead of serving stale numbers. No-op on an empty input.
 */
export async function markMonthsStale(db: Db, months: Iterable<string>): Promise<void> {
  for (const month of new Set(months)) {
    await markPeriodStale(db, "month", `${month}-01`);
  }
}
