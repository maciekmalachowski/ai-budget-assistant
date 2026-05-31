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

  it("parses structured suggestions and calls Haiku with a cached system prompt", async () => {
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

  it("throws on malformed JSON in the response", async () => {
    const { client } = mockClient("not json");
    await expect(
      categorizeWithAI(client, [{ id: "t1", merchant: "X", description: "X", amountMinor: -1 }], ["Groceries"]),
    ).rejects.toThrow();
  });
});
