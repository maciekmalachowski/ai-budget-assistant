import type { Db } from "@/lib/supabase/admin";
import type { MerchantRule } from "@/lib/domain/types";
import { SEED_RULES } from "@/lib/categorize/seedRules";
import { getCategoryNameToId } from "@/lib/repos/categories";

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

/**
 * Idempotently load SEED_RULES into merchant_map (source='seed'). Skips any rule whose
 * (pattern, match_type) already exists, and silently skips patterns whose category name
 * isn't in the taxonomy. Returns the number of rules inserted.
 */
export async function seedMerchantRules(db: Db): Promise<number> {
  const nameToId = await getCategoryNameToId(db);
  const { data: existing, error } = await db.from("merchant_map").select("pattern, match_type");
  if (error) throw new Error(error.message);
  const seen = new Set((existing ?? []).map((r) => `${r.match_type}::${r.pattern}`));

  const toInsert = SEED_RULES.flatMap((r) => {
    const categoryId = nameToId.get(r.categoryName);
    if (!categoryId) return [];
    if (seen.has(`${r.matchType}::${r.pattern}`)) return [];
    return [{ pattern: r.pattern, match_type: r.matchType, category_id: categoryId, source: "seed" }];
  });
  if (toInsert.length === 0) return 0;

  const { error: insErr } = await db.from("merchant_map").insert(toInsert);
  if (insErr) throw new Error(insErr.message);
  return toInsert.length;
}

/**
 * Persist a learned rule from a confident AI categorization — but only if no rule with the
 * same (pattern, match_type) already exists, so we never clobber a user or seed rule.
 * Returns true if a new rule was written.
 */
export async function insertAiRuleIfAbsent(
  db: Db,
  input: { pattern: string; matchType: MerchantRule["matchType"]; categoryId: string },
): Promise<boolean> {
  const { data: existing, error: selErr } = await db
    .from("merchant_map")
    .select("id")
    .eq("pattern", input.pattern)
    .eq("match_type", input.matchType)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);
  if (existing) return false;

  const { error } = await db.from("merchant_map").insert({
    pattern: input.pattern,
    match_type: input.matchType,
    category_id: input.categoryId,
    source: "ai",
  });
  if (error) throw new Error(error.message);
  return true;
}
