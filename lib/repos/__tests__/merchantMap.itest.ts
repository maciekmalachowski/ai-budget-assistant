import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadRules, upsertUserRule } from "@/lib/repos/merchantMap";
import { getCategoryNameToId } from "@/lib/repos/categories";

const db = createAdminClient();
const PATTERN = "ITEST_MERCHANT_MAP_PATTERN";
let groceriesId: string;
let transportId: string;

beforeAll(async () => {
  const map = await getCategoryNameToId(db);
  groceriesId = map.get("Groceries")!;
  transportId = map.get("Transport")!;
});

afterAll(async () => {
  await db.from("merchant_map").delete().eq("pattern", PATTERN);
});

describe.sequential("merchant_map repository (integration)", () => {
  it("inserts a new user rule, then updates it in place on repeat", async () => {
    const id1 = await upsertUserRule(db, { pattern: PATTERN, matchType: "contains", categoryId: groceriesId });
    const id2 = await upsertUserRule(db, { pattern: PATTERN, matchType: "contains", categoryId: transportId });
    expect(id2).toBe(id1); // same row, repointed

    const { data } = await db.from("merchant_map").select("category_id, source").eq("id", id1).single();
    expect(data?.category_id).toBe(transportId);
    expect(data?.source).toBe("user");
  });

  it("loadRules returns the rule as a domain MerchantRule and orders exact before contains", async () => {
    await upsertUserRule(db, { pattern: PATTERN, matchType: "exact", categoryId: groceriesId });
    const rules = await loadRules(db);
    const ours = rules.filter((r) => r.pattern === PATTERN);
    expect(ours.map((r) => r.matchType)).toEqual(["exact", "contains"]);
    expect(ours[0]).toEqual({ matchType: "exact", pattern: PATTERN, categoryId: groceriesId });
  });
});
