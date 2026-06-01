import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { categorizeWithAI } from "@/lib/ai/categorize";

function mockClient(text: string) {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: "text", text }],
    usage: { input_tokens: 10, output_tokens: 5 },
  });
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

describe("categorizeWithAI", () => {
  it("returns [] without calling the API when there are no items", async () => {
    const { client, create } = mockClient("{}");
    expect(await categorizeWithAI(client, [], ["Groceries"])).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("parses suggestions and calls Haiku with a cached system prompt", async () => {
    const { client, create } = mockClient(
      JSON.stringify({
        results: [
          { id: "t1", category: "Groceries", confidence: 0.95 },
          { id: "t2", category: "Unknown", confidence: 0.2 },
        ],
      }),
    );
    const out = await categorizeWithAI(
      client,
      [
        { id: "t1", merchant: "BIEDRONKA", description: "BIEDRONKA 123", amountMinor: -8740 },
        { id: "t2", merchant: "ZZZ", description: "ZZZ", amountMinor: -100 },
      ],
      ["Groceries", "Transport"],
    );
    expect(out).toEqual([
      { id: "t1", category: "Groceries", confidence: 0.95 },
      { id: "t2", category: "Unknown", confidence: 0.2 },
    ]);
    const arg = create.mock.calls[0][0];
    expect(arg.model).toBe("claude-haiku-4-5");
    expect(arg.system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("normalizes off-taxonomy categories to Unknown, clamps confidence, and fills missing ids", async () => {
    const { client } = mockClient(
      JSON.stringify({
        results: [
          { id: "t1", category: "Bogus", confidence: 1.5 }, // off-taxonomy + out-of-range
          { id: "t99", category: "Groceries", confidence: 0.5 }, // hallucinated id -> ignored
        ],
      }),
    );
    const out = await categorizeWithAI(
      client,
      [
        { id: "t1", merchant: "X", description: "X", amountMinor: -1 },
        { id: "t2", merchant: "Y", description: "Y", amountMinor: -2 }, // missing from results -> Unknown
      ],
      ["Groceries"],
    );
    expect(out).toEqual([
      { id: "t1", category: "Unknown", confidence: 1 },
      { id: "t2", category: "Unknown", confidence: 0 },
    ]);
  });

  it("parses JSON even when wrapped in a markdown code fence", async () => {
    const { client } = mockClient(
      '```json\n{"results":[{"id":"t1","category":"Groceries","confidence":0.9}]}\n```',
    );
    const out = await categorizeWithAI(
      client,
      [{ id: "t1", merchant: "BIEDRONKA", description: "B", amountMinor: -1 }],
      ["Groceries"],
    );
    expect(out).toEqual([{ id: "t1", category: "Groceries", confidence: 0.9 }]);
  });

  it("degrades the whole batch to Unknown on unparseable output (does not throw)", async () => {
    const { client } = mockClient("not json");
    const out = await categorizeWithAI(
      client,
      [{ id: "t1", merchant: "X", description: "X", amountMinor: -1 }],
      ["Groceries"],
    );
    expect(out).toEqual([{ id: "t1", category: "Unknown", confidence: 0 }]);
  });
});
