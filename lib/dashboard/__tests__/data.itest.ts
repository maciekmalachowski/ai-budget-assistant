import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDashboardData } from "@/lib/dashboard/data";
import { insertDrafts } from "@/lib/repos/transactions";
import { getCategoryNameToId } from "@/lib/repos/categories";
import type { TransactionDraft } from "@/lib/domain/types";

const db = createAdminClient();
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
  const { data, error } = await db.from("accounts").insert({ name: "ITEST dash acct", currency: "PLN" }).select("id").single();
  if (error) throw new Error(error.message);
  acctId = data.id;
  const groceriesId = (await getCategoryNameToId(db)).get("Groceries")!;
  await insertDrafts(db, acctId, null, [
    draft({ dedupHash: "da1", bookedAt: "2026-05-04", amountMinor: -13000, merchant: "BIEDRONKA", categoryId: groceriesId, categorySource: "rule" }),
    draft({ dedupHash: "da2", bookedAt: "2026-05-20", amountMinor: -5000, merchant: "MPK", categoryId: null, categorySource: "uncategorized" }),
    draft({ dedupHash: "da3", bookedAt: "2026-04-15", amountMinor: -9000, merchant: "BIEDRONKA", categoryId: groceriesId, categorySource: "rule" }),
  ]);
});

afterAll(async () => {
  await db.from("accounts").delete().eq("id", acctId);
});

describe.sequential("getDashboardData (integration)", () => {
  it("assembles month spend/income/net, pacing, category split, a 6-point trend, and recents", async () => {
    // todayISO at month end → daysElapsed == daysInMonth (31), so projection == actual spend.
    const d = await getDashboardData(db, { month: "2026-05", accountId: acctId, todayISO: "2026-05-31" });
    expect(d.spentThisMonthMinor).toBe(-18000);
    expect(d.spentLastMonthMinor).toBe(-9000);
    expect(d.incomeThisMonthMinor).toBe(0);
    expect(d.netThisMonthMinor).toBe(-18000);
    expect(d.savingsRatePct).toBeNull(); // no income this month
    expect(d.projectedMonthEndMinor).toBe(-18000); // elapsed==full month
    expect(d.avgDailySpendMinor).toBe(-581); // round(-18000 / 31)
    expect(d.byCategory).toEqual([
      { category: "Groceries", spentMinor: -13000 },
      { category: "Uncategorized", spentMinor: -5000 },
    ]);
    expect(d.trend).toHaveLength(6);
    expect(d.trend[d.trend.length - 1]).toEqual({ month: "2026-05", spentMinor: -18000, incomeMinor: 0, netMinor: -18000 });
    expect(d.recent.length).toBe(3);
    expect(d.recent[0].bookedAt).toBe("2026-05-20"); // newest first
  });
});
