import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { generateInsight, type InsightStatPack } from "@/lib/ai/insights";

const pack: InsightStatPack = {
  periodLabel: "May 2026",
  currency: "PLN",
  totalSpentMinor: -482000,
  totalIncomeMinor: 950000,
  byCategory: [{ category: "Groceries", spentMinor: -121000 }],
  vsPrevious: [{ category: "Groceries", deltaPct: 30 }],
  topMerchants: [{ merchant: "BIEDRONKA", spentMinor: -87400 }],
  newMerchants: ["NETFLIX"],
};

describe("generateInsight", () => {
  it("sends the stat pack to Sonnet with a cached system prompt and returns the narrative", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "  Groceries up 30% vs April.  " }],
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const out = await generateInsight(client, pack);

    expect(out).toBe("Groceries up 30% vs April.");
    const arg = create.mock.calls[0][0];
    expect(arg.model).toBe("claude-sonnet-4-6");
    expect(arg.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(arg.messages[0].content).toContain("May 2026");
  });

  it("throws when the response has no text content", async () => {
    const create = vi.fn().mockResolvedValue({ content: [] });
    const client = { messages: { create } } as unknown as Anthropic;
    await expect(generateInsight(client, pack)).rejects.toThrow();
  });
});
