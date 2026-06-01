import type { Db } from "@/lib/supabase/admin";
import type { TransactionDraft } from "@/lib/domain/types";

const HASH_QUERY_CHUNK = 500;

/**
 * The subset of `hashes` that already exist for this account. Chunked so it stays
 * well under PostgREST's max-rows / URL limits on large batches. (Used for import preview.)
 */
export async function getExistingHashes(
  db: Db,
  accountId: string,
  hashes: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < hashes.length; i += HASH_QUERY_CHUNK) {
    const slice = hashes.slice(i, i + HASH_QUERY_CHUNK);
    const { data, error } = await db
      .from("transactions")
      .select("dedup_hash")
      .eq("account_id", accountId)
      .in("dedup_hash", slice);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) found.add(row.dedup_hash);
  }
  return found;
}

export interface InsertResult {
  inserted: number;
  duplicates: number;
}

/**
 * Insert transaction drafts for an account, atomically skipping any whose
 * (account_id, dedup_hash) already exists. Relies on the DB unique constraint via
 * upsert/ignoreDuplicates, so it is free of check-then-insert races and IN() size caps.
 */
export async function insertDrafts(
  db: Db,
  accountId: string,
  importBatchId: string | null,
  drafts: TransactionDraft[],
): Promise<InsertResult> {
  if (drafts.length === 0) return { inserted: 0, duplicates: 0 };

  const rows = drafts.map((d) => ({
    account_id: accountId,
    booked_at: d.bookedAt,
    amount_minor: d.amountMinor,
    currency: d.currency,
    raw_description: d.rawDescription,
    merchant: d.merchant,
    category_id: d.categoryId,
    category_source: d.categorySource,
    ai_confidence: d.aiConfidence ?? null,
    import_batch_id: importBatchId,
    dedup_hash: d.dedupHash,
  }));

  const { error, count } = await db
    .from("transactions")
    .upsert(rows, {
      onConflict: "account_id,dedup_hash",
      ignoreDuplicates: true,
      count: "exact",
    });
  if (error) throw new Error(error.message);

  const inserted = count ?? 0;
  return { inserted, duplicates: drafts.length - inserted };
}
