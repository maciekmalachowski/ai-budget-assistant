import { describe, it, expect } from "vitest";
import { learnableRules } from "@/lib/import/run";
import type { TransactionDraft } from "@/lib/domain/types";
import type { CategorySuggestion } from "@/lib/ai/categorize";

const draft = (merchant: string, txnType: TransactionDraft["txnType"]): TransactionDraft => ({
  bookedAt: "2026-05-31", amountMinor: -1000, currency: "PLN",
  rawDescription: merchant, merchant, txnType,
  dedupHash: merchant, categoryId: null, categorySource: "uncategorized",
});

describe("learnableRules", () => {
  const nameToId = new Map([["Groceries", "cat-groceries"], ["Transfer", "cat-transfer"]]);

  it("learns an exact rule for a confident card/blik merchant", () => {
    const drafts = [draft("ALDI", "card")];
    const suggestions = new Map<string, CategorySuggestion>([["ALDI", { id: "ALDI", category: "Groceries", confidence: 0.95 }]]);
    expect(learnableRules(drafts, suggestions, nameToId)).toEqual([
      { pattern: "ALDI", matchType: "exact", categoryId: "cat-groceries" },
    ]);
  });

  it("does NOT learn for person-to-person transfers (category varies per txn)", () => {
    const drafts = [draft("Julia Zakrzewska", "transfer")];
    const suggestions = new Map<string, CategorySuggestion>([["Julia Zakrzewska", { id: "Julia Zakrzewska", category: "Transfer", confidence: 0.99 }]]);
    expect(learnableRules(drafts, suggestions, nameToId)).toEqual([]);
  });

  it("does NOT learn below the threshold or for unknown categories", () => {
    const drafts = [draft("MB&SJ", "card"), draft("FOO", "card")];
    const suggestions = new Map<string, CategorySuggestion>([
      ["MB&SJ", { id: "MB&SJ", category: "Groceries", confidence: 0.5 }],
      ["FOO", { id: "FOO", category: "Unknown", confidence: 0.99 }],
    ]);
    expect(learnableRules(drafts, suggestions, nameToId)).toEqual([]);
  });
});
