import type { Db } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import type { ColumnMapping, RawRow } from "@/lib/domain/types";
import { extractMerchant } from "@/lib/domain/merchant";
import { classifyTransaction } from "@/lib/domain/txnType";
import { applyMapping } from "@/lib/csv/mapping";
import { titleDedupBaseKey, titleDedupHash } from "@/lib/domain/normalize";
import { loadRules } from "@/lib/repos/merchantMap";
import { markMonthsStale } from "@/lib/repos/insights";
import { categorizeByRules } from "@/lib/categorize/rules";

type TxUpdate = Database["public"]["Tables"]["transactions"]["Update"];

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
  const touchedMonths = new Set<string>();

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("transactions")
      .select("id, booked_at, raw_description, merchant, category_id, category_source")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const t of rows) {
      result.scanned++;
      const txnType = classifyTransaction(t.raw_description, "");
      const merchant = extractMerchant(txnType, t.raw_description, "");
      const update: Partial<TxUpdate> = {};
      if (merchant !== t.merchant) update.merchant = merchant;

      if (t.category_source !== "user") {
        // DB-only backfill has no separable note (just the stored line), so we can't safely scope
        // brand-keyword rules for person transfers — disable them via containsText:"" to avoid
        // payee/keyword collisions (e.g. "Agata Nowak" → Shopping). Exact rules still apply.
        const categoryId =
          txnType === "transfer" || txnType === "internal"
            ? categorizeByRules(t.raw_description, merchant, rules, { containsText: "" })
            : categorizeByRules(t.raw_description, merchant, rules);
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
        touchedMonths.add(t.booked_at.slice(0, 7)); // its month's insight stats just changed
      }
    }

    if (rows.length < PAGE) break;
  }

  // Re-derived merchants / re-applied rules changed those months' stats — invalidate caches.
  await markMonthsStale(db, touchedMonths);
  return result;
}

export interface EnrichResult {
  matched: number;
  updated: number;
  unmatched: number;
}

/**
 * Recover structured fields (title/counterparty/account) for ALREADY-IMPORTED rows from the
 * original CSV without creating duplicates. For each CSV row we recompute the (title-based)
 * dedup hash exactly as the importer does, find the existing transaction by (account_id,
 * dedup_hash), and update its raw_description + merchant + structured fields — and its category
 * when the row was not user-corrected.
 *
 * Backfill-only + idempotent: only rows whose `title` is still null are touched, so rows already
 * carrying structured fields (e.g. freshly imported in the same request) are left untouched —
 * this is what stops the auto-enrich pass from clobbering a just-assigned AI category. As a
 * fast path, the whole pass short-circuits when the account has no un-enriched rows, avoiding
 * the per-row lookups entirely once a backfill has completed.
 */
export async function enrichFromCsv(
  db: Db,
  input: { accountId: string; rows: RawRow[]; mapping: ColumnMapping },
): Promise<EnrichResult> {
  const result: EnrichResult = { matched: 0, updated: 0, unmatched: 0 };

  const { count: pending } = await db
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("account_id", input.accountId)
    .is("title", null);
  if (!pending) return result; // nothing left to backfill — skip the per-row lookups

  const rules = await loadRules(db);
  const occurrence = new Map<string, number>();
  const touchedMonths = new Set<string>();

  for (const row of input.rows) {
    let fields;
    try {
      fields = applyMapping(row, input.mapping);
    } catch {
      continue; // skip unparseable rows (e.g. the preamble)
    }
    const txnType = classifyTransaction(fields.title, fields.counterparty);
    const merchant = extractMerchant(txnType, fields.title, fields.counterparty);

    // Same title-based dedup key/hash as the importer (shared helpers) so existing rows match.
    const baseKey = titleDedupBaseKey(input.accountId, fields);
    const occ = occurrence.get(baseKey) ?? 0;
    occurrence.set(baseKey, occ + 1);
    const dedupHash = titleDedupHash(input.accountId, fields, occ);

    const { data: existing, error } = await db
      .from("transactions")
      .select("id, booked_at, category_id, category_source")
      .eq("account_id", input.accountId)
      .eq("dedup_hash", dedupHash)
      .is("title", null) // backfill only: never re-touch an already-enriched row
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!existing) {
      result.unmatched++;
      continue;
    }
    result.matched++;

    const update: TxUpdate = {
      raw_description: fields.rawDescription,
      merchant,
      title: fields.title || null,
      counterparty: fields.counterparty || null,
      counterparty_account: fields.counterpartyAccount || null,
    };
    if (existing.category_source !== "user") {
      // Scope brand-keyword rules to the note for person transfers, so a payee name that
      // collides with a seed keyword (e.g. "Agata Nowak" vs AGATA) isn't mis-categorized.
      const categoryId =
        txnType === "transfer" || txnType === "internal"
          ? categorizeByRules(fields.rawDescription, merchant, rules, { containsText: fields.title })
          : categorizeByRules(fields.rawDescription, merchant, rules);
      if (categoryId) {
        update.category_id = categoryId;
        update.category_source = "rule";
        update.ai_confidence = null;
      }
    }
    const { error: upErr } = await db.from("transactions").update(update).eq("id", existing.id);
    if (upErr) throw new Error(upErr.message);
    result.updated++;
    touchedMonths.add(existing.booked_at.slice(0, 7)); // merchant/category just changed for this month
  }

  // Enrichment rewrote merchant (and sometimes category) on pre-existing rows — often in
  // months runImport never touched — so invalidate those months' cached insights.
  await markMonthsStale(db, touchedMonths);
  return result;
}
