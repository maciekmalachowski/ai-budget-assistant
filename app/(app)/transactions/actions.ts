"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyCorrection } from "@/lib/transactions/correct";
import { deleteTransactions as deleteTransactionsRepo, updateTransactionNotes } from "@/lib/repos/transactions";

const MAX_NOTES_LEN = 2000;

export interface CorrectResult {
  ok: boolean;
  error?: string;
}

export interface DeleteResult {
  ok: boolean;
  deleted?: number;
  error?: string;
}

export interface NotesResult {
  ok: boolean;
  error?: string;
}

/** Server Action: apply a category correction from the transactions table, then revalidate the affected pages. */
export async function correctCategory(input: {
  transactionId: string;
  merchant: string | null;
  categoryName: string;
}): Promise<CorrectResult> {
  try {
    await applyCorrection(createAdminClient(), input);
    revalidatePath("/transactions");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Correction failed" };
  }
}

/**
 * Server Action: permanently delete the given transactions, then revalidate the affected pages.
 *
 * Trust model: `ids` originate from the server-rendered transactions list (not user-typed input),
 * and this is a single-user app whose RLS is `using (true)` with the admin client. A future
 * multi-user refactor MUST add UUID validation + a per-user predicate here.
 */
export async function deleteTransactions(input: { ids: string[] }): Promise<DeleteResult> {
  const ids = input?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string" && id.length > 0)) {
    return { ok: false, error: "No transactions selected." };
  }
  try {
    const deleted = await deleteTransactionsRepo(createAdminClient(), ids);
    revalidatePath("/transactions");
    revalidatePath("/");
    return { ok: true, deleted };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Delete failed" };
  }
}

/**
 * Server Action: set/clear a transaction's free-text notes, then revalidate the list.
 * Same trust model as deleteTransactions — transactionId comes from server-rendered rows in a
 * single-user app; a future multi-user refactor must add UUID validation + a per-user predicate.
 * Notes are persisted/rendered as plain text (never HTML), so the only guard needed is a length cap.
 */
export async function updateNotes(input: { transactionId: string; notes: string }): Promise<NotesResult> {
  if (typeof input?.transactionId !== "string" || !input.transactionId) {
    return { ok: false, error: "Invalid transaction." };
  }
  if (typeof input?.notes !== "string" || input.notes.length > MAX_NOTES_LEN) {
    return { ok: false, error: `Notes must be text under ${MAX_NOTES_LEN} characters.` };
  }
  try {
    await updateTransactionNotes(createAdminClient(), input.transactionId, input.notes);
    revalidatePath("/transactions");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save notes" };
  }
}
