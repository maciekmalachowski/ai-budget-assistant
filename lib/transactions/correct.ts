import type { Db } from "@/lib/supabase/admin";
import { getCategoryNameToId } from "@/lib/repos/categories";
import { getTransactionMonths, updateTransactionCategory } from "@/lib/repos/transactions";
import { upsertUserRule } from "@/lib/repos/merchantMap";
import { markMonthsStale } from "@/lib/repos/insights";

/**
 * Apply a manual category correction: set the transaction to the chosen category
 * with source "user" (protected from future overwrite), and — when the row has a
 * merchant — learn an `exact` merchant_map rule on the brand-level merchant so
 * future imports of the same merchant categorize automatically. Throws on an
 * unknown category name.
 */
export async function applyCorrection(
  db: Db,
  input: { transactionId: string; merchant: string | null; categoryName: string },
): Promise<void> {
  const nameToId = await getCategoryNameToId(db);
  const categoryId = nameToId.get(input.categoryName);
  if (!categoryId) throw new Error(`Unknown category: ${input.categoryName}`);

  await updateTransactionCategory(db, input.transactionId, categoryId, "user");

  // The row's category changed, so its month's cached insight is now wrong — drop it.
  // Best-effort: the correction already committed; cache invalidation must not fail it.
  try {
    await markMonthsStale(db, await getTransactionMonths(db, [input.transactionId]));
  } catch {
    // ignore — the next read/refresh still regenerates
  }

  const pattern = (input.merchant ?? "").trim();
  if (pattern) {
    await upsertUserRule(db, { pattern, matchType: "exact", categoryId });
  }
}
