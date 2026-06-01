import type { Db } from "@/lib/supabase/admin";
import type { MerchantRule } from "@/lib/domain/types";

const MATCH_PRIORITY: Record<MerchantRule["matchType"], number> = {
  exact: 0,
  contains: 1,
  regex: 2,
};

/**
 * All categorization rules as domain MerchantRule[], ordered so the categorizer
 * tries exact rules before contains before regex (its first-match-wins loop
 * depends on this precedence).
 */
export async function loadRules(db: Db): Promise<MerchantRule[]> {
  const { data, error } = await db
    .from("merchant_map")
    .select("match_type, pattern, category_id")
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((r) => ({
      matchType: r.match_type as MerchantRule["matchType"],
      pattern: r.pattern,
      categoryId: r.category_id,
    }))
    .sort((a, b) => MATCH_PRIORITY[a.matchType] - MATCH_PRIORITY[b.matchType]);
}

/**
 * Record a learned rule from a manual correction. If a rule with the same
 * (pattern, match_type) exists, repoint it to the new category and mark it
 * user-sourced; otherwise insert a new user rule. Returns the rule id.
 * (merchant_map has no unique constraint on pattern, so this is find-then-write.)
 */
export async function upsertUserRule(
  db: Db,
  input: { pattern: string; matchType: MerchantRule["matchType"]; categoryId: string },
): Promise<string> {
  const { data: existing, error: selErr } = await db
    .from("merchant_map")
    .select("id")
    .eq("pattern", input.pattern)
    .eq("match_type", input.matchType)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);

  if (existing) {
    const { error } = await db
      .from("merchant_map")
      .update({ category_id: input.categoryId, source: "user" })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return existing.id;
  }

  const { data, error } = await db
    .from("merchant_map")
    .insert({
      pattern: input.pattern,
      match_type: input.matchType,
      category_id: input.categoryId,
      source: "user",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}
