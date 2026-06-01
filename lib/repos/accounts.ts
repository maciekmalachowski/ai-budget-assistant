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
