import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrGenerateInsight } from "@/lib/insights/service";
import { insertDrafts } from "@/lib/repos/transactions";
import type { TransactionDraft } from "@/lib/domain/types";

const db = createAdminClient();
let acctId: string;
const PERIOD = "2098-03"; // far-future sentinel month so it can't collide with real data
const PERIOD_START = "2098-03-01";

function draft(over: Partial<TransactionDraft>): TransactionDraft {
  return {
    bookedAt: "2098-03-10",
    amountMinor: -5000,
    currency: "PLN",
    rawDescription: "x",
    merchant: "X",
    dedupHash: "s",
    categoryId: null,
    categorySource: "uncategorized",
    ...over,
  };
}

function fakeAnthropic() {
  const create = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "You spent a bit in March." }] });
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

beforeAll(async () => {
  const { data, error } = await db.from("accounts").insert({ name: "ITEST insights acct", currency: "PLN" }).select("id").single();
  if (error) throw new Error(error.message);
  acctId = data.id;
  await insertDrafts(db, acctId, null, [
    draft({ dedupHash: "is1", bookedAt: "2098-03-04", amountMinor: -12000, merchant: "BIEDRONKA" }),
  ]);
});

afterAll(async () => {
  await db.from("accounts").delete().eq("id", acctId);
  await db.from("insights").delete().eq("period_start", PERIOD_START);
});

describe.sequential("getOrGenerateInsight (integration)", () => {
  it("generates + caches on a miss, then serves from cache on the second call", async () => {
    const ai1 = fakeAnthropic();
    const first = await getOrGenerateInsight({ db, anthropic: ai1.client }, { period: PERIOD });
    expect(first.cached).toBe(false);
    expect(first.summaryMd).toContain("March");
    expect(ai1.create).toHaveBeenCalledTimes(1);

    const ai2 = fakeAnthropic();
    const second = await getOrGenerateInsight({ db, anthropic: ai2.client }, { period: PERIOD });
    expect(second.cached).toBe(true);
    expect(second.summaryMd).toBe(first.summaryMd);
    expect(ai2.create).not.toHaveBeenCalled(); // served from cache, no model call
  });
});
