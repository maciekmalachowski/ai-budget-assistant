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

/** Strip a Markdown code fence if the model wrapped its JSON in one. */
function stripFences(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1].trim() : t;
}

function clampConfidence(c: number): number {
  if (!Number.isFinite(c)) return 0;
  return Math.max(0, Math.min(1, c));
}

/**
 * Classify a batch of unknown-merchant transactions with Claude (Haiku).
 * Returns exactly one suggestion per input item (in input order). Model output is
 * normalized: off-taxonomy categories and missing/duplicate/hallucinated ids become
 * "Unknown"; confidence is clamped to 0..1. Unusable model output (no text / unparseable)
 * degrades the whole batch to "Unknown" rather than throwing — so categorization never
 * blocks an import. Genuine API/transport errors still propagate to the caller.
 */
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
        // cache_control engages once this prefix exceeds the model's cache minimum
        // (~1024 tokens for Haiku); it's a harmless no-op below that as the taxonomy grows.
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

  const allUnknown = (): CategorySuggestion[] =>
    items.map((i) => ({ id: i.id, category: "Unknown", confidence: 0 }));

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return allUnknown();

  let parsed: z.infer<typeof SuggestionSchema>;
  try {
    parsed = SuggestionSchema.parse(JSON.parse(stripFences(textBlock.text)));
  } catch {
    return allUnknown();
  }

  const allowed = new Set([...taxonomy, "Unknown"]);
  const inputIds = new Set(items.map((i) => i.id));
  const byId = new Map<string, CategorySuggestion>();
  for (const r of parsed.results) {
    if (!inputIds.has(r.id) || byId.has(r.id)) continue; // ignore hallucinated/duplicate ids
    byId.set(r.id, {
      id: r.id,
      category: allowed.has(r.category) ? r.category : "Unknown",
      confidence: clampConfidence(r.confidence),
    });
  }
  return items.map((i) => byId.get(i.id) ?? { id: i.id, category: "Unknown", confidence: 0 });
}
