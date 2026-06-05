import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { insertDrafts, getExistingHashes, getTransactionsInRange, listTransactions, updateTransactionCategory, deleteTransactions } from "@/lib/repos/transactions";
import { getCategoryNameToId, getCategoryNameToId as getNameToId2 } from "@/lib/repos/categories";
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

describe.sequential("transactions repository (integration)", () => {
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

describe.sequential("transactions query/update (integration)", () => {
  let acctId: string;
  let groceriesId: string;

  beforeAll(async () => {
    const { data, error } = await db
      .from("accounts")
      .insert({ name: "ITEST query acct", currency: "PLN" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    acctId = data.id;
    groceriesId = (await getCategoryNameToId(db)).get("Groceries")!;

    await insertDrafts(db, acctId, null, [
      draft({ dedupHash: "q1", bookedAt: "2026-05-05", amountMinor: -8740, merchant: "BIEDRONKA", categoryId: groceriesId, categorySource: "rule" }),
      draft({ dedupHash: "q2", bookedAt: "2026-05-20", amountMinor: -5000, merchant: "MPK", categoryId: null, categorySource: "uncategorized" }),
      draft({ dedupHash: "q3", bookedAt: "2026-04-30", amountMinor: -1200, merchant: "OLD", categoryId: null, categorySource: "uncategorized" }),
    ]);
  });

  afterAll(async () => {
    await db.from("accounts").delete().eq("id", acctId);
  });

  it("getTransactionsInRange returns only in-range rows with category names flattened", async () => {
    const rows = await getTransactionsInRange(db, { fromISO: "2026-05-01", toISO: "2026-05-31", accountId: acctId });
    expect(rows).toHaveLength(2);
    const biedronka = rows.find((r) => r.merchant === "BIEDRONKA");
    expect(biedronka?.categoryName).toBe("Groceries");
    expect(biedronka?.amountMinor).toBe(-8740);
  });

  it("listTransactions filters by merchant substring and caps/sorts results", async () => {
    const rows = await listTransactions(db, { accountId: acctId, merchant: "biedron" });
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("Groceries");
    expect(rows[0].bookedAt).toBe("2026-05-05");
  });

  it("listTransactions returns [] for an unknown category name", async () => {
    const rows = await listTransactions(db, { accountId: acctId, category: "NoSuchCategory" });
    expect(rows).toEqual([]);
  });

  it("updateTransactionCategory repoints a row and marks it user-sourced", async () => {
    const list = await listTransactions(db, { accountId: acctId, merchant: "MPK" });
    await updateTransactionCategory(db, list[0].id, groceriesId, "user");
    const after = await listTransactions(db, { accountId: acctId, merchant: "MPK" });
    expect(after[0].category).toBe("Groceries");
  });
});

describe.sequential("listTransactions needsReview filter (integration)", () => {
  let acctId: string;

  beforeAll(async () => {
    const { data, error } = await db.from("accounts").insert({ name: "ITEST review acct", currency: "PLN" }).select("id").single();
    if (error) throw new Error(error.message);
    acctId = data.id;
    const groceriesId = (await getNameToId2(db)).get("Groceries")!;
    await insertDrafts(db, acctId, null, [
      draft({ dedupHash: "nr1", merchant: "RULED", categoryId: groceriesId, categorySource: "rule" }),
      draft({ dedupHash: "nr2", merchant: "LOWAI", categoryId: groceriesId, categorySource: "ai", aiConfidence: 0.3 }),
      draft({ dedupHash: "nr3", merchant: "HIAI", categoryId: groceriesId, categorySource: "ai", aiConfidence: 0.95 }),
      draft({ dedupHash: "nr4", merchant: "NONE", categoryId: null, categorySource: "uncategorized" }),
    ]);
  });

  afterAll(async () => {
    await db.from("accounts").delete().eq("id", acctId);
  });

  it("returns only uncategorized and low-confidence AI rows", async () => {
    const rows = await listTransactions(db, { accountId: acctId, needsReview: true });
    const merchants = rows.map((r) => r.merchant).sort();
    expect(merchants).toEqual(["LOWAI", "NONE"]);
  });

  it("exposes categorySource and aiConfidence on rows", async () => {
    const all = await listTransactions(db, { accountId: acctId });
    const hi = all.find((r) => r.merchant === "HIAI");
    expect(hi?.categorySource).toBe("ai");
    expect(hi?.aiConfidence).toBeCloseTo(0.95, 2);
  });
});

describe.sequential("deleteTransactions (integration)", () => {
  let acctId: string;

  beforeAll(async () => {
    const { data, error } = await db.from("accounts").insert({ name: "ITEST delete acct", currency: "PLN" }).select("id").single();
    if (error) throw new Error(error.message);
    acctId = data.id;
    await insertDrafts(db, acctId, null, [
      draft({ dedupHash: "d1", merchant: "DEL1" }),
      draft({ dedupHash: "d2", merchant: "DEL2" }),
      draft({ dedupHash: "d3", merchant: "KEEP" }),
    ]);
  });

  afterAll(async () => {
    await db.from("accounts").delete().eq("id", acctId);
  });

  it("returns 0 and runs no query for an empty id list", async () => {
    expect(await deleteTransactions(db, [])).toBe(0);
  });

  it("deletes only the given ids and leaves the rest", async () => {
    const all = await listTransactions(db, { accountId: acctId });
    const toDelete = all.filter((r) => r.merchant === "DEL1" || r.merchant === "DEL2").map((r) => r.id);
    const removed = await deleteTransactions(db, toDelete);
    expect(removed).toBe(2);

    const after = await listTransactions(db, { accountId: acctId });
    expect(after.map((r) => r.merchant)).toEqual(["KEEP"]);
  });
});

describe("listTransactions same-day ordering", () => {
  it("orders same-day rows newest-created first", async () => {
    const { data: acc } = await db.from("accounts").insert({ name: "SortAcc", currency: "PLN" }).select("id").single();
    const accountId = acc!.id;
    try {
      await db.from("transactions").insert([
        { account_id: accountId, booked_at: "2026-06-10", amount_minor: -100, currency: "PLN", raw_description: "first", dedup_hash: "sort-h1" },
        { account_id: accountId, booked_at: "2026-06-10", amount_minor: -200, currency: "PLN", raw_description: "second", dedup_hash: "sort-h2" },
      ]);
      const rows = await listTransactions(db, { accountId, limit: 10 });
      // both same booked_at; created_at desc => the second insert comes first
      expect(rows[0].rawDescription).toBe("second");
      expect(rows[1].rawDescription).toBe("first");
    } finally {
      await db.from("transactions").delete().eq("account_id", accountId);
      await db.from("accounts").delete().eq("id", accountId);
    }
  });
});
