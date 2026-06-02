import type { Db } from "@/lib/supabase/admin";

export interface Category {
  id: string;
  name: string;
  kind: "expense" | "income" | "transfer";
  color: string | null;
}

/** All categories, ordered by name. */
export async function listCategories(db: Db): Promise<Category[]> {
  const { data, error } = await db
    .from("categories")
    .select("id, name, kind, color")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind as Category["kind"],
    color: c.color,
  }));
}

/** Category names only — the taxonomy passed to the AI categorizer. */
export async function getTaxonomy(db: Db): Promise<string[]> {
  return (await listCategories(db)).map((c) => c.name);
}

/** Map of category name → id, for turning category-name results into FKs. */
export async function getCategoryNameToId(db: Db): Promise<Map<string, string>> {
  return new Map((await listCategories(db)).map((c) => [c.name, c.id]));
}

export interface CategoryWithCount extends Category {
  isSystem: boolean;
  transactionCount: number;
}

/** Categories with transaction counts + system flag, ordered by name (Settings page). */
export async function listCategoriesWithCounts(db: Db): Promise<CategoryWithCount[]> {
  const { data, error } = await db
    .from("categories")
    .select("id, name, kind, color, is_system, transactions(count)")
    .order("name")
    .returns<
      {
        id: string;
        name: string;
        kind: string;
        color: string | null;
        is_system: boolean;
        transactions: { count: number }[];
      }[]
    >();
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind as Category["kind"],
    color: c.color,
    isSystem: c.is_system,
    transactionCount: c.transactions[0]?.count ?? 0,
  }));
}

/** Create a category; returns its id. Throws on a duplicate name (unique constraint). */
export async function createCategory(
  db: Db,
  input: { name: string; kind: Category["kind"]; color?: string | null },
): Promise<string> {
  const { data, error } = await db
    .from("categories")
    .insert({ name: input.name, kind: input.kind, color: input.color ?? null })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

/** Rename a category. Throws on a duplicate name. */
export async function renameCategory(db: Db, id: string, name: string): Promise<void> {
  const { error } = await db.from("categories").update({ name }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Change a category's color (null clears it). */
export async function recolorCategory(db: Db, id: string, color: string | null): Promise<void> {
  const { error } = await db.from("categories").update({ color }).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Delete a category. Refuses system categories (they're part of the seeded
 * taxonomy). For user categories, the DB handles dependents: transactions.category_id
 * is SET NULL and merchant_map rows CASCADE-delete.
 */
export async function deleteCategory(db: Db, id: string): Promise<void> {
  const { data, error } = await db.from("categories").select("is_system").eq("id", id).single();
  if (error) throw new Error(error.message);
  if (data.is_system) throw new Error("System categories can't be deleted.");
  const { error: delErr } = await db.from("categories").delete().eq("id", id);
  if (delErr) throw new Error(delErr.message);
}
