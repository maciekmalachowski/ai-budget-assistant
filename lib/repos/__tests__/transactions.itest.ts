import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { insertDrafts, getExistingHashes } from "@/lib/repos/transactions";
import type { TransactionDraft } from "@/lib/domain/types";

const db = createAdminClient();
let accountId: string;

function draft(over: Partial<TransactionDraft> = {}): TransactionDraft {
  return {
    bookedAt: "2026-05-12",
    amountMinor: -8740,
    currency: "PLN",
    rawDescription: "BIEDRONKA 1234 WARSZAWA",
    merchant: "BIEDRONKA WARSZAWA",
    dedupHash: "hash-a",
    categoryId: null,
    categorySource: "uncategorized",
    ...over,
  };
}

beforeAll(async () => {
  const { data, error } = await db
    .from("accounts")
    .insert({ name: "ITEST mBank", currency: "PLN" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  accountId = data.id;
});

afterAll(async () => {
  // Cascades delete the account's transactions.
  await db.from("accounts").delete().eq("id", accountId);
});

describe("transactions repository (integration)", () => {
  it("inserts fresh drafts and reports counts", async () => {
    const res = await insertDrafts(db, accountId, null, [
      draft({ dedupHash: "h1" }),
      draft({ dedupHash: "h2", amountMinor: -2400 }),
    ]);
    expect(res).toEqual({ inserted: 2, duplicates: 0 });

    const { count } = await db
      .from("transactions")
      .select("*", { count: "exact", head: true })
      .eq("account_id", accountId);
    expect(count).toBe(2);
  });

  it("skips drafts whose dedup_hash already exists for the account", async () => {
    const res = await insertDrafts(db, accountId, null, [
      draft({ dedupHash: "h1" }), // already inserted above
      draft({ dedupHash: "h3", amountMinor: -100 }), // new
    ]);
    expect(res).toEqual({ inserted: 1, duplicates: 1 });
  });

  it("getExistingHashes returns only the hashes present for the account", async () => {
    const set = await getExistingHashes(db, accountId, ["h1", "h2", "h3", "nope"]);
    expect(set.has("h1")).toBe(true);
    expect(set.has("h3")).toBe(true);
    expect(set.has("nope")).toBe(false);
  });

  it("returns zeros for an empty draft list", async () => {
    expect(await insertDrafts(db, accountId, null, [])).toEqual({ inserted: 0, duplicates: 0 });
  });
});
