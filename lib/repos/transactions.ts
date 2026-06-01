import type { Db } from "@/lib/supabase/admin";
import type { TransactionDraft, CategorySource } from "@/lib/domain/types";
import type { TxnRow } from "@/lib/queries/types";
import { getCategoryNameToId } from "@/lib/repos/categories";

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

const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MAX = 200;

/** Transactions booked within [fromISO, toISO] (inclusive), flattened for the pure aggregators. */
export async function getTransactionsInRange(
  db: Db,
  opts: { fromISO: string; toISO: string; accountId?: string },
): Promise<TxnRow[]> {
  let q = db
    .from("transactions")
    .select("amount_minor, merchant, currency, category:categories(name)")
    .gte("booked_at", opts.fromISO)
    .lte("booked_at", opts.toISO);
  if (opts.accountId) q = q.eq("account_id", opts.accountId);

  const { data, error } = await q.returns<
    { amount_minor: number; merchant: string | null; currency: string; category: { name: string } | null }[]
  >();
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    amountMinor: Number(r.amount_minor),
    merchant: r.merchant,
    currency: r.currency,
    categoryName: r.category?.name ?? null,
  }));
}

export interface TxnFilter {
  fromISO?: string;
  toISO?: string;
  /** Category name; an unknown name yields no rows. */
  category?: string;
  /** Case-insensitive merchant substring. */
  merchant?: string;
  minAmountMinor?: number;
  maxAmountMinor?: number;
  accountId?: string;
  /** Capped at 200; defaults to 50. */
  limit?: number;
}

export interface TxnListItem {
  id: string;
  bookedAt: string;
  amountMinor: number;
  currency: string;
  merchant: string | null;
  rawDescription: string;
  category: string | null;
}

/** Filtered, newest-first, row-capped transaction list (for the list_transactions Q&A tool and the table UI). */
export async function listTransactions(db: Db, filter: TxnFilter = {}): Promise<TxnListItem[]> {
  let categoryId: string | undefined;
  if (filter.category) {
    const nameToId = await getCategoryNameToId(db);
    categoryId = nameToId.get(filter.category);
    if (!categoryId) return []; // unknown category name → no matches
  }

  // Apply all filters first (filter builder), THEN order/limit (transform builder):
  // supabase-js filter methods (.gte/.eq/.ilike) are not available after .order()/.limit().
  let q = db
    .from("transactions")
    .select("id, booked_at, amount_minor, currency, merchant, raw_description, category:categories(name)");
  if (filter.fromISO) q = q.gte("booked_at", filter.fromISO);
  if (filter.toISO) q = q.lte("booked_at", filter.toISO);
  if (categoryId) q = q.eq("category_id", categoryId);
  if (filter.merchant) q = q.ilike("merchant", `%${filter.merchant}%`);
  if (filter.minAmountMinor !== undefined) q = q.gte("amount_minor", filter.minAmountMinor);
  if (filter.maxAmountMinor !== undefined) q = q.lte("amount_minor", filter.maxAmountMinor);
  if (filter.accountId) q = q.eq("account_id", filter.accountId);

  const { data, error } = await q
    .order("booked_at", { ascending: false })
    .limit(Math.min(filter.limit ?? LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX))
    .returns<
      {
        id: string;
        booked_at: string;
        amount_minor: number;
        currency: string;
        merchant: string | null;
        raw_description: string;
        category: { name: string } | null;
      }[]
    >();
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    bookedAt: r.booked_at,
    amountMinor: Number(r.amount_minor),
    currency: r.currency,
    merchant: r.merchant,
    rawDescription: r.raw_description,
    category: r.category?.name ?? null,
  }));
}

/** Set a transaction's category + how it was decided. Clears ai_confidence (used for user/rule corrections). */
export async function updateTransactionCategory(
  db: Db,
  transactionId: string,
  categoryId: string | null,
  source: CategorySource,
): Promise<void> {
  const { error } = await db
    .from("transactions")
    .update({ category_id: categoryId, category_source: source, ai_confidence: null })
    .eq("id", transactionId);
  if (error) throw new Error(error.message);
}
