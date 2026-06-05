import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyCorrection } from "@/lib/transactions/correct";
import { insertDrafts, listTransactions } from "@/lib/repos/transactions";
import { getCachedInsight, upsertInsight } from "@/lib/repos/insights";

const db = createAdminClient();
let acctId: string;
const MERCHANT = "ITEST_CORRECT_MERCHANT";
// Far-future sentinel month so seeding/staling its insight can't touch real cached data.
const PERIOD_START = "2097-05-01";

beforeAll(async () => {
  const { data, error } = await db.from("accounts").insert({ name: "ITEST correct acct", currency: "PLN" }).select("id").single();
  if (error) throw new Error(error.message);
  acctId = data.id;
  await insertDrafts(db, acctId, null, [
    {
      bookedAt: "2097-05-09",
      amountMinor: -4200,
      currency: "PLN",
      rawDescription: `${MERCHANT} 1`,
      merchant: MERCHANT,
      dedupHash: "corr1",
      categoryId: null,
      categorySource: "uncategorized",
    },
  ]);
});

afterAll(async () => {
  await db.from("accounts").delete().eq("id", acctId);
  await db.from("merchant_map").delete().eq("pattern", MERCHANT);
  await db.from("insights").delete().eq("period_start", PERIOD_START);
});

describe.sequential("applyCorrection (integration)", () => {
  it("sets the transaction to user-sourced and learns an exact rule", async () => {
    const before = await listTransactions(db, { accountId: acctId });
    const txnId = before[0].id;

    await applyCorrection(db, { transactionId: txnId, merchant: MERCHANT, categoryName: "Transport" });

    const after = await listTransactions(db, { accountId: acctId });
    expect(after[0].category).toBe("Transport");
    expect(after[0].categorySource).toBe("user");

    const { data: rules } = await db.from("merchant_map").select("match_type, source, category_id").eq("pattern", MERCHANT);
    expect(rules).toHaveLength(1);
    expect(rules?.[0].match_type).toBe("exact");
    expect(rules?.[0].source).toBe("user");
  });

  it("throws on an unknown category", async () => {
    const rows = await listTransactions(db, { accountId: acctId });
    await expect(applyCorrection(db, { transactionId: rows[0].id, merchant: null, categoryName: "Nope" })).rejects.toThrow();
  });

  it("invalidates the cached insight for the transaction's month", async () => {
    await upsertInsight(db, { periodType: "month", periodStart: PERIOD_START, summaryMd: "fresh", stats: {} });
    const rows = await listTransactions(db, { accountId: acctId });

    await applyCorrection(db, { transactionId: rows[0].id, merchant: MERCHANT, categoryName: "Groceries" });

    expect((await getCachedInsight(db, "month", PERIOD_START))?.stale).toBe(true);
  });
});
