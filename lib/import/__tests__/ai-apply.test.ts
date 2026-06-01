import { describe, it, expect } from "vitest";
import { applyAiCategories, AI_CONFIDENCE_THRESHOLD } from "@/lib/import/ai-apply";
import type { TransactionDraft } from "@/lib/domain/types";
import type { CategorySuggestion } from "@/lib/ai/categorize";

function draft(over: Partial<TransactionDraft>): TransactionDraft {
  return {
    bookedAt: "2026-05-01",
    amountMinor: -1000,
    currency: "PLN",
    rawDescription: "x",
    merchant: "X",
    dedupHash: "h",
    categoryId: null,
    categorySource: "uncategorized",
    ...over,
  };
}

const nameToId = new Map([
  ["Groceries", "cat-groceries"],
  ["Transport", "cat-transport"],
]);

describe("applyAiCategories", () => {
  it("leaves rule-categorized drafts untouched", () => {
    const d = draft({ merchant: "BIEDRONKA", categoryId: "cat-groceries", categorySource: "rule" });
    const sugg = new Map<string, CategorySuggestion>([
      ["BIEDRONKA", { id: "BIEDRONKA", category: "Transport", confidence: 0.99 }],
    ]);
    expect(applyAiCategories([d], sugg, nameToId)).toEqual([d]);
  });

  it("applies a confident, in-taxonomy suggestion as category_source=ai", () => {
    const d = draft({ merchant: "BIEDRONKA" });
    const sugg = new Map<string, CategorySuggestion>([
      ["BIEDRONKA", { id: "BIEDRONKA", category: "Groceries", confidence: 0.9 }],
    ]);
    expect(applyAiCategories([d], sugg, nameToId)).toEqual([
      { ...d, categoryId: "cat-groceries", categorySource: "ai", aiConfidence: 0.9 },
    ]);
  });

  it("leaves a low-confidence suggestion uncategorized but records the confidence", () => {
    const d = draft({ merchant: "ZZZ" });
    const sugg = new Map<string, CategorySuggestion>([
      ["ZZZ", { id: "ZZZ", category: "Groceries", confidence: 0.3 }],
    ]);
    expect(applyAiCategories([d], sugg, nameToId)).toEqual([{ ...d, aiConfidence: 0.3 }]);
  });

  it("leaves off-taxonomy / Unknown suggestions uncategorized", () => {
    const d = draft({ merchant: "ZZZ" });
    const sugg = new Map<string, CategorySuggestion>([
      ["ZZZ", { id: "ZZZ", category: "Unknown", confidence: 0.95 }],
    ]);
    expect(applyAiCategories([d], sugg, nameToId)).toEqual([{ ...d, aiConfidence: 0.95 }]);
  });

  it("leaves a draft with no suggestion untouched", () => {
    const d = draft({ merchant: "NOSUGGEST" });
    expect(applyAiCategories([d], new Map(), nameToId)).toEqual([d]);
  });

  it("exposes a sane default threshold", () => {
    expect(AI_CONFIDENCE_THRESHOLD).toBeGreaterThan(0);
    expect(AI_CONFIDENCE_THRESHOLD).toBeLessThan(1);
  });
});
