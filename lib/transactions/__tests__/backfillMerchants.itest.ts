import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { backfillMerchants } from "@/lib/transactions/backfillMerchants";
import { getCategoryNameToId } from "@/lib/repos/categories";
import { insertDrafts, listTransactions } from "@/lib/repos/transactions";

const db = createAdminClient();
let acctId: string;
let groceriesId: string;
const RULE_PATTERN = "ELECLERC";

const CARD_ELECLERC = "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 12.48 PLN eLeclerc 01 Gdansk";
const CARD_ALDI = "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 3.39 PLN ALDI SP. Z O.O. 06 GDANSK";

beforeAll(async () => {
  const nameToId = await getCategoryNameToId(db);
  groceriesId = nameToId.get("Groceries")!;

  const { data, error } = await db
    .from("accounts")
    .insert({ name: "ITEST backfill acct", currency: "PLN" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  acctId = data.id;

  // An exact rule on the brand — should match the eLeclerc row after backfill.
  await db.from("merchant_map").insert({
    pattern: RULE_PATTERN,
    match_type: "exact",
    category_id: groceriesId,
    source: "user",
  });

  await insertDrafts(db, acctId, null, [
    // Uncategorized card row with the OLD noisy merchant stored.
    {
      bookedAt: "2026-05-31",
      amountMinor: -1248,
      currency: "PLN",
      rawDescription: CARD_ELECLERC,
      merchant: CARD_ELECLERC.toUpperCase(),
      dedupHash: "bf-eleclerc",
      categoryId: null,
      categorySource: "uncategorized",
    },
    // A user-corrected row — its category must be preserved, but merchant refreshed.
    {
      bookedAt: "2026-05-31",
      amountMinor: -339,
      currency: "PLN",
      rawDescription: CARD_ALDI,
      merchant: CARD_ALDI.toUpperCase(),
      dedupHash: "bf-aldi",
      categoryId: groceriesId,
      categorySource: "user",
    },
  ]);
});

afterAll(async () => {
  await db.from("accounts").delete().eq("id", acctId);
  await db.from("merchant_map").delete().eq("pattern", RULE_PATTERN);
});

describe.sequential("backfillMerchants (integration)", () => {
  it("re-derives merchants, re-rules non-user rows, and preserves user rows", async () => {
    const result = await backfillMerchants(db);
    expect(result.scanned).toBeGreaterThanOrEqual(2);

    const rows = await listTransactions(db, { accountId: acctId });
    const eleclerc = rows.find((r) => r.rawDescription === CARD_ELECLERC)!;
    const aldi = rows.find((r) => r.rawDescription === CARD_ALDI)!;

    // Uncategorized eLeclerc row: merchant cleaned + matched by the exact rule.
    expect(eleclerc.merchant).toBe("ELECLERC");
    expect(eleclerc.category).toBe("Groceries");
    expect(eleclerc.categorySource).toBe("rule");

    // User-corrected ALDI row: merchant cleaned, but category/source untouched.
    expect(aldi.merchant).toBe("ALDI");
    expect(aldi.category).toBe("Groceries");
    expect(aldi.categorySource).toBe("user");
  }, 30000);

  it("is idempotent — a second run changes nothing", async () => {
    const second = await backfillMerchants(db);
    const rows = await listTransactions(db, { accountId: acctId });
    const eleclerc = rows.find((r) => r.rawDescription === CARD_ELECLERC)!;
    expect(eleclerc.merchant).toBe("ELECLERC");
    expect(eleclerc.categorySource).toBe("rule");
    const aldi = rows.find((r) => r.rawDescription === CARD_ALDI)!;
    expect(aldi.merchant).toBe("ALDI");
    expect(aldi.category).toBe("Groceries");
    expect(aldi.categorySource).toBe("user");
    expect(second.scanned).toBeGreaterThanOrEqual(2);
  }, 30000);
});
