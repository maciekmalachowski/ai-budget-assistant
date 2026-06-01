import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createQueryTools } from "@/lib/queries/tools";
import { insertDrafts } from "@/lib/repos/transactions";
import { getCategoryNameToId } from "@/lib/repos/categories";
import type { TransactionDraft } from "@/lib/domain/types";

const db = createAdminClient();
const tools = createQueryTools(db);
let acctId: string;

function draft(over: Partial<TransactionDraft>): TransactionDraft {
  return {
    bookedAt: "2026-05-10",
    amountMinor: -1000,
    currency: "PLN",
    rawDescription: "x",
    merchant: "X",
    dedupHash: "d",
    categoryId: null,
    categorySource: "uncategorized",
    ...over,
  };
}

beforeAll(async () => {
  const { data, error } = await db.from("accounts").insert({ name: "ITEST tools acct", currency: "PLN" }).select("id").single();
  if (error) throw new Error(error.message);
  acctId = data.id;
  const groceriesId = (await getCategoryNameToId(db)).get("Groceries")!;
  await insertDrafts(db, acctId, null, [
    draft({ dedupHash: "tt1", bookedAt: "2026-05-05", amountMinor: -8000, merchant: "BIEDRONKA", categoryId: groceriesId, categorySource: "rule" }),
    draft({ dedupHash: "tt2", bookedAt: "2026-05-06", amountMinor: -2000, merchant: "BIEDRONKA", categoryId: groceriesId, categorySource: "rule" }),
    draft({ dedupHash: "tt3", bookedAt: "2026-05-07", amountMinor: 500000, merchant: "EMPLOYER", categoryId: null, categorySource: "uncategorized" }),
  ]);
});

afterAll(async () => {
  await db.from("accounts").delete().eq("id", acctId);
});

describe.sequential("createQueryTools (integration)", () => {
  it("totals splits spend vs income for the month", async () => {
    expect(await tools.totals({ period: "2026-05", accountId: acctId })).toEqual({
      totalSpentMinor: -10000,
      totalIncomeMinor: 500000,
      netMinor: 490000,
    });
  });

  it("totals can restrict to expense only", async () => {
    expect(await tools.totals({ period: "2026-05", kind: "expense", accountId: acctId })).toEqual({ totalSpentMinor: -10000 });
  });

  it("spend_by_category groups the month's expenses", async () => {
    const out = (await tools.spend_by_category({ period: "2026-05", accountId: acctId })) as { category: string; spentMinor: number }[];
    expect(out).toEqual([{ category: "Groceries", spentMinor: -10000 }]);
  });

  it("list_transactions filters by merchant", async () => {
    const out = (await tools.list_transactions({ merchant: "BIEDRONKA" })) as { merchant: string | null }[];
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.every((r) => r.merchant === "BIEDRONKA")).toBe(true);
  });
});
