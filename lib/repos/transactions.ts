import type { Db } from "@/lib/supabase/admin";
import type { TransactionDraft, CategorySource } from "@/lib/domain/types";
import type { TxnRow } from "@/lib/queries/types";
import { getCategoryNameToId } from "@/lib/repos/categories";
import { AI_CONFIDENCE_THRESHOLD } from "@/lib/import/ai-apply";

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
    title: d.title || null,
    counterparty: d.counterparty || null,
    counterparty_account: d.counterpartyAccount || null,
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

/**
 * The distinct "YYYY-MM" months that the given transactions are booked in. Used to
 * invalidate cached insights for exactly the affected months on correct/delete.
 * Chunked like getExistingHashes to stay under PostgREST URL limits. Empty in → empty out.
 */
export async function getTransactionMonths(db: Db, ids: string[]): Promise<string[]> {
  const months = new Set<string>();
  for (let i = 0; i < ids.length; i += HASH_QUERY_CHUNK) {
    const slice = ids.slice(i, i + HASH_QUERY_CHUNK);
    const { data, error } = await db
      .from("transactions")
      .select("booked_at")
      .in("id", slice)
      .returns<{ booked_at: string }[]>();
    if (error) throw new Error(error.message);
    // booked_at is a Postgres `date`, returned as an ISO "YYYY-MM-DD" string.
    for (const row of data ?? []) months.add(row.booked_at.slice(0, 7));
  }
  return [...months];
}

/**
 * The distinct "YYYY-MM" months that have at least one transaction, newest first.
 * Powers the Transactions page month filter. Selects only the `booked_at` date
 * column and dedupes in JS (PostgREST has no DISTINCT); fine for a single user's
 * history. Empty table → [].
 */
export async function getDistinctMonths(db: Db): Promise<string[]> {
  const { data, error } = await db
    .from("transactions")
    .select("booked_at")
    .order("booked_at", { ascending: false })
    .limit(10_000) // defensive: stay clear of any PostgREST max-rows cap (>> a single user's history)
    .returns<{ booked_at: string }[]>();
  if (error) throw new Error(error.message);
  // Rows arrive newest-first; a Set preserves insertion order (ES2015 §23.2), so months stay desc.
  const months = new Set<string>();
  for (const row of data ?? []) months.add(row.booked_at.slice(0, 7));
  return [...months];
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
  /** Only rows that need attention: uncategorized, or AI-categorized below the confidence threshold. */
  needsReview?: boolean;
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
  title: string | null;
  counterparty: string | null;
  counterpartyAccount: string | null;
  notes: string | null;
  category: string | null;
  categorySource: string;
  aiConfidence: number | null;
}

/** Filtered, newest-first, row-capped transaction list (for the table UI and the list_transactions Q&A tool). */
export async function listTransactions(db: Db, filter: TxnFilter = {}): Promise<TxnListItem[]> {
  let categoryId: string | undefined;
  if (filter.category) {
    const nameToId = await getCategoryNameToId(db);
    categoryId = nameToId.get(filter.category);
    if (!categoryId) return []; // unknown category name → no matches
  }

  // Filters first (filter builder), THEN order/limit (transform builder).
  let q = db
    .from("transactions")
    .select(
      "id, booked_at, amount_minor, currency, merchant, raw_description, title, counterparty, counterparty_account, notes, category_source, ai_confidence, category:categories(name)",
    );
  if (filter.fromISO) q = q.gte("booked_at", filter.fromISO);
  if (filter.toISO) q = q.lte("booked_at", filter.toISO);
  if (categoryId) q = q.eq("category_id", categoryId);
  if (filter.merchant) q = q.ilike("merchant", `%${filter.merchant}%`);
  if (filter.minAmountMinor !== undefined) q = q.gte("amount_minor", filter.minAmountMinor);
  if (filter.maxAmountMinor !== undefined) q = q.lte("amount_minor", filter.maxAmountMinor);
  if (filter.accountId) q = q.eq("account_id", filter.accountId);
  if (filter.needsReview) {
    q = q.or(`category_source.eq.uncategorized,and(category_source.eq.ai,ai_confidence.lt.${AI_CONFIDENCE_THRESHOLD})`);
  }

  const { data, error } = await q
    .order("booked_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(Math.min(filter.limit ?? LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX))
    .returns<
      {
        id: string;
        booked_at: string;
        amount_minor: number;
        currency: string;
        merchant: string | null;
        raw_description: string;
        title: string | null;
        counterparty: string | null;
        counterparty_account: string | null;
        notes: string | null;
        category_source: string;
        ai_confidence: number | null;
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
    title: r.title,
    counterparty: r.counterparty,
    counterpartyAccount: r.counterparty_account,
    notes: r.notes,
    category: r.category?.name ?? null,
    categorySource: r.category_source,
    aiConfidence: r.ai_confidence,
  }));
}

/**
 * Hard-delete the given transactions by id. Chunked on HASH_QUERY_CHUNK so the
 * `.in("id", ...)` filter stays under PostgREST's URL limits on large batches
 * (mirrors getExistingHashes). Returns the total number of rows actually removed.
 */
export async function deleteTransactions(db: Db, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;

  let deleted = 0;
  for (let i = 0; i < ids.length; i += HASH_QUERY_CHUNK) {
    const slice = ids.slice(i, i + HASH_QUERY_CHUNK);
    const { error, count } = await db
      .from("transactions")
      .delete({ count: "exact" })
      .in("id", slice);
    if (error) throw new Error(error.message);
    deleted += count ?? 0;
  }
  return deleted;
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

/** Set (or clear, with "") a transaction's free-text notes. */
export async function updateTransactionNotes(db: Db, transactionId: string, notes: string): Promise<void> {
  const trimmed = notes.trim();
  const { error } = await db
    .from("transactions")
    .update({ notes: trimmed === "" ? null : trimmed })
    .eq("id", transactionId);
  if (error) throw new Error(error.message);
}
