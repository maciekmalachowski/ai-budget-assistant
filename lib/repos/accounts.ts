import type { Db } from "@/lib/supabase/admin";

export interface Account {
  id: string;
  name: string;
  currency: string;
}

/** All accounts, oldest first. */
export async function listAccounts(db: Db): Promise<Account[]> {
  const { data, error } = await db
    .from("accounts")
    .select("id, name, currency")
    .order("created_at");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Create an account (currency defaults to PLN); returns its id. */
export async function createAccount(db: Db, input: { name: string; currency?: string }): Promise<string> {
  const { data, error } = await db
    .from("accounts")
    .insert({ name: input.name, currency: input.currency ?? "PLN" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export interface AccountWithCount extends Account {
  transactionCount: number;
}

/** Accounts with their transaction counts, oldest first (for the Settings page). */
export async function listAccountsWithCounts(db: Db): Promise<AccountWithCount[]> {
  const { data, error } = await db
    .from("accounts")
    .select("id, name, currency, transactions(count)")
    .order("created_at")
    .returns<{ id: string; name: string; currency: string; transactions: { count: number }[] }[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    currency: a.currency,
    transactionCount: a.transactions[0]?.count ?? 0,
  }));
}

/** Rename an account. */
export async function renameAccount(db: Db, id: string, name: string): Promise<void> {
  const { error } = await db.from("accounts").update({ name }).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Delete an account. Refuses if it still has transactions — the FK is ON DELETE
 * CASCADE, so deleting an account with transactions would silently destroy them.
 */
export async function deleteAccount(db: Db, id: string): Promise<void> {
  const { count, error } = await db
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("account_id", id);
  if (error) throw new Error(error.message);
  if ((count ?? 0) > 0) {
    throw new Error(`This account has ${count} transactions. Delete or reassign them before removing the account.`);
  }
  const { error: delErr } = await db.from("accounts").delete().eq("id", id);
  if (delErr) throw new Error(delErr.message);
}
