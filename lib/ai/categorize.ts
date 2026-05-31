import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MODELS } from "@/lib/ai/models";

export interface CategorizationItem {
  id: string;
  merchant: string;
  description: string;
  amountMinor: number;
}

export interface CategorySuggestion {
  id: string;
  /** A category name from the taxonomy, or "Unknown". */
  category: string;
  /** Model certainty, 0..1. */
  confidence: number;
}

const SuggestionSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      category: z.string(),
      confidence: z.number(),
    }),
  ),
});

const SYSTEM = `You categorize bank transactions into a fixed set of spending categories.
For each transaction, choose exactly one category from the taxonomy, or "Unknown" if you are not reasonably sure.
"confidence" is your certainty from 0 to 1.
Respond with ONLY a JSON object of the form {"results":[{"id":string,"category":string,"confidence":number}]} and nothing else — no prose, no code fences.`;

/** Classify a batch of unknown-merchant transactions with Claude (Haiku). */
export async function categorizeWithAI(
  client: Anthropic,
  items: CategorizationItem[],
  taxonomy: string[],
): Promise<CategorySuggestion[]> {
  if (items.length === 0) return [];

  const response = await client.messages.create({
    model: MODELS.categorize,
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: `${SYSTEM}\n\nTaxonomy (allowed categories): ${taxonomy.join(", ")}, Unknown`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: JSON.stringify(
          items.map((i) => ({
            id: i.id,
            merchant: i.merchant,
            description: i.description,
            amountMinor: i.amountMinor,
          })),
        ),
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Categorization response contained no text block");
  }
  const parsed = SuggestionSchema.parse(JSON.parse(textBlock.text));
  return parsed.results;
}
