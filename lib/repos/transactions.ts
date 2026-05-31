import type { Db } from "@/lib/supabase/admin";
import type { TransactionDraft } from "@/lib/domain/types";

/** The set of dedup_hashes from `hashes` that already exist for this account. */
export async function getExistingHashes(
  db: Db,
  accountId: string,
  hashes: string[],
): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const { data, error } = await db
    .from("transactions")
    .select("dedup_hash")
    .eq("account_id", accountId)
    .in("dedup_hash", hashes);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.dedup_hash));
}

export interface InsertResult {
  inserted: number;
  duplicates: number;
}

/**
 * Insert transaction drafts for an account, skipping any whose dedup_hash already
 * exists for that account. Returns how many were inserted vs skipped as duplicates.
 */
export async function insertDrafts(
  db: Db,
  accountId: string,
  importBatchId: string | null,
  drafts: TransactionDraft[],
): Promise<InsertResult> {
  if (drafts.length === 0) return { inserted: 0, duplicates: 0 };

  const existing = await getExistingHashes(
    db,
    accountId,
    drafts.map((d) => d.dedupHash),
  );
  const fresh = drafts.filter((d) => !existing.has(d.dedupHash));
  const duplicates = drafts.length - fresh.length;
  if (fresh.length === 0) return { inserted: 0, duplicates };

  const rows = fresh.map((d) => ({
    account_id: accountId,
    booked_at: d.bookedAt,
    amount_minor: d.amountMinor,
    currency: d.currency,
    raw_description: d.rawDescription,
    merchant: d.merchant,
    category_id: d.categoryId,
    category_source: d.categorySource,
    import_batch_id: importBatchId,
    dedup_hash: d.dedupHash,
  }));

  const { error, count } = await db
    .from("transactions")
    .insert(rows, { count: "exact" });
  if (error) throw new Error(error.message);
  return { inserted: count ?? fresh.length, duplicates };
}
