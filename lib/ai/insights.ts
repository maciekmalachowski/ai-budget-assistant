import Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "@/lib/ai/models";

/** Compact, pre-computed numbers handed to the model (no raw transactions). */
export interface InsightStatPack {
  periodLabel: string;
  currency: string;
  totalSpentMinor: number;
  totalIncomeMinor: number;
  byCategory: { category: string; spentMinor: number }[];
  vsPrevious: { category: string; deltaPct: number }[];
  topMerchants: { merchant: string; spentMinor: number }[];
  newMerchants: string[];
}

const SYSTEM = `You write a short, friendly monthly money summary for one person, in Markdown.
You are given pre-computed statistics (amounts are integer minor units — divide by 100 and show the currency).
Write 2-4 short bullet points highlighting the most notable things (big movers vs the previous period, top spend, new recurring merchants). Do not invent numbers beyond what is provided. No headings, no preamble.`;

/** Turn a compact stat pack into a short Markdown narrative (Sonnet). */
export async function generateInsight(client: Anthropic, statPack: InsightStatPack): Promise<string> {
  const response = await client.messages.create({
    model: MODELS.insights,
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: JSON.stringify(statPack) }],
  });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
