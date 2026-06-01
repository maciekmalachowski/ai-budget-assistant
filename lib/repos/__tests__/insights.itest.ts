import { describe, it, expect, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCachedInsight, upsertInsight, markPeriodStale } from "@/lib/repos/insights";
import { logQa } from "@/lib/repos/qaHistory";

const db = createAdminClient();
const PERIOD_START = "2099-01-01"; // far-future sentinel so it can't collide with real data
const qaIds: string[] = [];

afterAll(async () => {
  await db.from("insights").delete().eq("period_start", PERIOD_START);
  if (qaIds.length) await db.from("qa_history").delete().in("id", qaIds);
});

describe.sequential("insights + qa_history repositories (integration)", () => {
  it("inserts a cached insight, then updates it in place and clears stale", async () => {
    const id1 = await upsertInsight(db, { periodType: "month", periodStart: PERIOD_START, summaryMd: "first", stats: { a: 1 } });
    await markPeriodStale(db, "month", PERIOD_START);
    expect((await getCachedInsight(db, "month", PERIOD_START))?.stale).toBe(true);

    const id2 = await upsertInsight(db, { periodType: "month", periodStart: PERIOD_START, summaryMd: "second", stats: { a: 2 } });
    expect(id2).toBe(id1);
    const cached = await getCachedInsight(db, "month", PERIOD_START);
    expect(cached?.summaryMd).toBe("second");
    expect(cached?.stale).toBe(false);
    expect(cached?.stats).toEqual({ a: 2 });
  });

  it("returns null for an uncached period", async () => {
    expect(await getCachedInsight(db, "week", PERIOD_START)).toBeNull();
  });

  it("logs a Q&A interaction", async () => {
    const id = await logQa(db, { question: "how much on groceries?", answerMd: "4 820 zł", toolCalls: [{ name: "totals" }] });
    qaIds.push(id);
    const { data } = await db.from("qa_history").select("question, answer_md").eq("id", id).single();
    expect(data?.question).toBe("how much on groceries?");
    expect(data?.answer_md).toBe("4 820 zł");
  });
});
