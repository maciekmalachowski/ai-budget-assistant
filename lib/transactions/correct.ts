import type { Db } from "@/lib/supabase/admin";
import { getCategoryNameToId } from "@/lib/repos/categories";
import { updateTransactionCategory } from "@/lib/repos/transactions";
import { upsertUserRule } from "@/lib/repos/merchantMap";

/**
 * Apply a manual category correction: set the transaction to the chosen category
 * with source "user" (protected from future overwrite), and — when the row has a
 * merchant — learn a `contains` merchant_map rule so future imports of the same
 * merchant categorize automatically. Throws on an unknown category name.
 */
export async function applyCorrection(
  db: Db,
  input: { transactionId: string; merchant: string | null; categoryName: string },
): Promise<void> {
  const nameToId = await getCategoryNameToId(db);
  const categoryId = nameToId.get(input.categoryName);
  if (!categoryId) throw new Error(`Unknown category: ${input.categoryName}`);

  await updateTransactionCategory(db, input.transactionId, categoryId, "user");

  const pattern = (input.merchant ?? "").trim();
  if (pattern) {
    await upsertUserRule(db, { pattern, matchType: "contains", categoryId });
  }
}
