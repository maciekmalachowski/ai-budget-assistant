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
