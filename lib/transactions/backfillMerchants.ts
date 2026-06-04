import type { Db } from "@/lib/supabase/admin";
import { extractMerchant } from "@/lib/domain/merchant";
import { loadRules } from "@/lib/repos/merchantMap";
import { categorizeByRules } from "@/lib/categorize/rules";

export interface BackfillResult {
  scanned: number;
  merchantsUpdated: number;
  recategorized: number;
}

const PAGE = 1000;

/**
 * One-off, idempotent backfill: re-derive `merchant` for every transaction using the
 * current extractor, and re-apply merchant_map rules to rows that were NOT user-corrected
 * (uncategorized / ai / rule). User-corrected rows keep their category but still get a
 * refreshed merchant string. Does not call the AI.
 */
export async function backfillMerchants(db: Db): Promise<BackfillResult> {
  const rules = await loadRules(db);
  const result: BackfillResult = { scanned: 0, merchantsUpdated: 0, recategorized: 0 };

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("transactions")
      .select("id, raw_description, merchant, category_id, category_source")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const t of rows) {
      result.scanned++;
      const merchant = extractMerchant(t.raw_description);
      const update: Record<string, unknown> = {};
      if (merchant !== t.merchant) update.merchant = merchant;

      if (t.category_source !== "user") {
        const categoryId = categorizeByRules(t.raw_description, merchant, rules);
        if (categoryId && categoryId !== t.category_id) {
          update.category_id = categoryId;
          update.category_source = "rule";
          update.ai_confidence = null;
        }
      }

      if (Object.keys(update).length > 0) {
        const { error: upErr } = await db.from("transactions").update(update).eq("id", t.id);
        if (upErr) throw new Error(upErr.message);
        if ("merchant" in update) result.merchantsUpdated++;
        if ("category_id" in update) result.recategorized++;
      }
    }

    if (rows.length < PAGE) break;
  }

  return result;
}
