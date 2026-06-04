import type { TransactionDraft } from "@/lib/domain/types";
import type { CategorySuggestion } from "@/lib/ai/categorize";

/** Minimum model confidence to auto-apply an AI category; below this a row stays "needs review". */
export const AI_CONFIDENCE_THRESHOLD = 0.6;

/** Minimum confidence to PERSIST an AI guess as a reusable rule (stricter than auto-apply). */
export const AI_LEARN_THRESHOLD = 0.8;

/**
 * Apply AI category suggestions to uncategorized drafts (pure). Drafts already
 * categorized by a rule are returned unchanged. For each uncategorized draft we
 * look up its merchant's suggestion; if the suggested category is in the taxonomy
 * (`nameToId`) and meets `threshold`, the draft becomes category_source="ai" with
 * that category and confidence. Otherwise the draft stays uncategorized, but a
 * present-but-rejected suggestion's confidence is recorded in `aiConfidence`
 * (so the UI can surface low-confidence rows as "needs review").
 */
export function applyAiCategories(
  drafts: TransactionDraft[],
  suggestionByMerchant: Map<string, CategorySuggestion>,
  nameToId: Map<string, string>,
  threshold = AI_CONFIDENCE_THRESHOLD,
): TransactionDraft[] {
  return drafts.map((d) => {
    if (d.categoryId) return d; // already set by a rule
    const sugg = d.merchant ? suggestionByMerchant.get(d.merchant) : undefined;
    if (!sugg) return d;

    const categoryId = nameToId.get(sugg.category);
    if (categoryId && sugg.confidence >= threshold) {
      return { ...d, categoryId, categorySource: "ai", aiConfidence: sugg.confidence };
    }
    return { ...d, aiConfidence: sugg.confidence };
  });
}
