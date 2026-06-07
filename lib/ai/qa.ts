import Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "@/lib/ai/models";
import { QA_TOOLS, type QueryTools, type QueryToolName } from "@/lib/ai/tools";

export interface QaResult {
  answer: string;
  toolCalls: { name: string; input: unknown }[];
}

const SYSTEM = `You answer questions about the user's personal finances using ONLY the provided tools.
Never invent numbers — call a tool to get real data. Amounts are integer minor units (e.g. grosze); divide by 100 for display and include the currency. Be concise and direct.`;

/**
 * Answer a finance question by letting Claude (Sonnet) call read-only query tools.
 * Runs the manual tool-use loop, dispatching each tool_use to the injected `tools`.
 */
export async function answerQuestion(
  client: Anthropic,
  question: string,
  tools: QueryTools,
  opts: { maxRounds?: number } = {},
): Promise<QaResult> {
  const maxRounds = opts.maxRounds ?? 6;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];
  const toolCalls: { name: string; input: unknown }[] = [];

  for (let round = 0; round < maxRounds; round++) {
    const response = await client.messages.create({
      model: MODELS.qa,
      max_tokens: 1024,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }], // cache_control engages once system+tools exceed the model's cache minimum (~2048 tokens for Sonnet)
      tools: QA_TOOLS,
      messages: [...messages],
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      const answer = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      return { answer, toolCalls };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      toolCalls.push({ name: block.name, input: block.input });
      const impl = (tools as unknown as Record<string, ((input: unknown) => Promise<unknown>) | undefined>)[block.name];
      let resultText: string;
      try {
        const output = impl
          ? await impl(block.input)
          : { error: `Unknown tool: ${block.name}` };
        resultText = JSON.stringify(output);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // The model otherwise only sees this inside the tool_result and paraphrases it
        // (e.g. "wrong or missing API key") — log the real cause for diagnosis.
        console.error(`[qa] tool "${block.name}" failed:`, message);
        resultText = JSON.stringify({ error: message });
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return {
    answer:
      "I couldn't finish answering within the allowed number of steps. Please rephrase or narrow the question.",
    toolCalls,
  };
}

// Compile-time guard that QA_TOOLS names line up with the QueryTools contract.
const _toolNameCheck: QueryToolName[] = QA_TOOLS.map((t) => t.name as QueryToolName);
void _toolNameCheck;
