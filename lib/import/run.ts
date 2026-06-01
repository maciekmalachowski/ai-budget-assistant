import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/lib/supabase/admin";
import type { ColumnMapping, RawRow } from "@/lib/domain/types";
import { buildTransactionDrafts } from "@/lib/import/pipeline";
import { applyAiCategories } from "@/lib/import/ai-apply";
import { categorizeWithAI, type CategorizationItem, type CategorySuggestion } from "@/lib/ai/categorize";
import { loadRules } from "@/lib/repos/merchantMap";
import { getTaxonomy, getCategoryNameToId } from "@/lib/repos/categories";
import { insertDrafts } from "@/lib/repos/transactions";
import { createImportBatch, finalizeImportBatch } from "@/lib/repos/imports";

export interface RunImportInput {
  accountId: string;
  rows: RawRow[];
  mapping: ColumnMapping;
  fileName?: string | null;
}

export interface ImportSummary {
  batchId: string;
  rowCount: number;
  inserted: number;
  duplicates: number;
  aiCategorized: number;
  errors: { rowIndex: number; message: string }[];
}

/**
 * Run a CSV import end-to-end: open a batch, categorize by rules first, send only
 * the remaining unknown merchants to Claude in one batched call, apply the
 * confident suggestions, insert dedup-safely, and finalize the batch. AI failure
 * degrades gracefully — categorizeWithAI already returns all-"Unknown" on bad
 * output, and a thrown transport error is caught so the import still completes
 * (rows just stay uncategorized). A failure in the DB steps marks the batch failed.
 */
export async function runImport(deps: { db: Db; anthropic: Anthropic }, input: RunImportInput): Promise<ImportSummary> {
  const { db, anthropic } = deps;
  const batchId = await createImportBatch(db, {
    accountId: input.accountId,
    fileName: input.fileName ?? null,
    columnMapping: input.mapping,
    rowCount: input.rows.length,
    status: "mapped",
  });

  try {
    const rules = await loadRules(db);
    const { drafts, errors } = buildTransactionDrafts({
      accountId: input.accountId,
      rows: input.rows,
      mapping: input.mapping,
      rules,
    });

    const unknownMerchants = [
      ...new Set(drafts.filter((d) => !d.categoryId && d.merchant).map((d) => d.merchant)),
    ];

    let categorized = drafts;
    let aiCategorized = 0;
    if (unknownMerchants.length > 0) {
      const taxonomy = await getTaxonomy(db);
      const nameToId = await getCategoryNameToId(db);
      const items: CategorizationItem[] = unknownMerchants.map((m) => {
        const sample = drafts.find((d) => d.merchant === m)!;
        return { id: m, merchant: m, description: sample.rawDescription, amountMinor: sample.amountMinor };
      });

      let suggestions: CategorySuggestion[] = [];
      try {
        suggestions = await categorizeWithAI(anthropic, items, taxonomy);
      } catch {
        suggestions = []; // AI/transport failure → leave uncategorized; import still succeeds
      }
      const byMerchant = new Map(suggestions.map((s) => [s.id, s]));
      categorized = applyAiCategories(drafts, byMerchant, nameToId);
      aiCategorized = categorized.filter((d) => d.categorySource === "ai").length;
    }

    const { inserted, duplicates } = await insertDrafts(db, input.accountId, batchId, categorized);
    await finalizeImportBatch(db, batchId, {
      rowCount: input.rows.length,
      importedCount: inserted,
      duplicateCount: duplicates,
      status: "imported",
    });

    return { batchId, rowCount: input.rows.length, inserted, duplicates, aiCategorized, errors };
  } catch (err) {
    await finalizeImportBatch(db, batchId, {
      rowCount: input.rows.length,
      importedCount: 0,
      duplicateCount: 0,
      status: "failed",
    }).catch(() => {});
    throw err;
  }
}
