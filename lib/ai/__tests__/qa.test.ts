import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { answerQuestion } from "@/lib/ai/qa";
import type { QueryTools } from "@/lib/ai/tools";

function fakeTools(overrides: Partial<QueryTools> = {}): QueryTools {
  return {
    totals: vi.fn().mockResolvedValue({ expenseMinor: -482000 }),
    spend_by_category: vi.fn().mockResolvedValue([]),
    compare_periods: vi.fn().mockResolvedValue({}),
    top_merchants: vi.fn().mockResolvedValue([]),
    list_transactions: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("answerQuestion", () => {
  it("runs the tool-use loop: calls the tool, feeds the result back, returns the final answer", async () => {
    const create = vi
      .fn()
      // round 1: model asks to call `totals`
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_1", name: "totals", input: { period: "2026-05", kind: "expense" } }],
      })
      // round 2: model answers
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "You spent 4 820 zł in May 2026." }],
      });
    const client = { messages: { create } } as unknown as Anthropic;
    const tools = fakeTools();

    const result = await answerQuestion(client, "How much did I spend in May?", tools);

    expect(result.answer).toBe("You spent 4 820 zł in May 2026.");
    expect(result.toolCalls).toEqual([{ name: "totals", input: { period: "2026-05", kind: "expense" } }]);
    expect(tools.totals).toHaveBeenCalledWith({ period: "2026-05", kind: "expense" });
    // second call includes a tool_result for tu_1
    const secondMessages = create.mock.calls[1][0].messages;
    const lastUser = secondMessages[secondMessages.length - 1];
    expect(lastUser.role).toBe("user");
    expect(lastUser.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "tu_1" });
  });

  it("answers directly when the model uses no tools", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "I can help with that." }],
    });
    const client = { messages: { create } } as unknown as Anthropic;
    const result = await answerQuestion(client, "Hi", fakeTools());
    expect(result.answer).toBe("I can help with that.");
    expect(result.toolCalls).toEqual([]);
  });

  it("captures a tool error into the tool_result rather than throwing", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_1", name: "totals", input: { period: "bad" } }],
      })
      .mockResolvedValueOnce({ stop_reason: "end_turn", content: [{ type: "text", text: "Sorry." }] });
    const client = { messages: { create } } as unknown as Anthropic;
    const tools = fakeTools({ totals: vi.fn().mockRejectedValue(new Error("bad period")) });

    const result = await answerQuestion(client, "x", tools);
    expect(result.answer).toBe("Sorry.");
    const toolResult = create.mock.calls[1][0].messages.at(-1).content[0];
    expect(toolResult.content).toContain("bad period");
  });

  it("stops after maxRounds and returns a graceful fallback", async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "tu", name: "totals", input: { period: "2026-05" } }],
    });
    const client = { messages: { create } } as unknown as Anthropic;
    const result = await answerQuestion(client, "loop", fakeTools(), { maxRounds: 2 });
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.answer).toMatch(/couldn't/i);
  });
});
