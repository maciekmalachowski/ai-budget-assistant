import type {
  ColumnMapping,
  MerchantRule,
  RawRow,
  RowError,
  TransactionDraft,
} from "@/lib/domain/types";
import { applyMapping } from "@/lib/csv/mapping";
import { normalizeMerchant, computeDedupHash } from "@/lib/domain/normalize";
import { categorizeByRules } from "@/lib/categorize/rules";

export interface BuildDraftsInput {
  accountId: string;
  rows: RawRow[];
  mapping: ColumnMapping;
  rules: MerchantRule[];
}

export interface BuildDraftsResult {
  drafts: TransactionDraft[];
  errors: RowError[];
}

function canonicalDesc(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, " ").trim();
}

/**
 * Turn parsed CSV rows into ready-to-persist transaction drafts:
 * map → normalize → assign dedup hash (with same-batch occurrence index) → apply rules.
 * Rows that fail to parse are collected in `errors` without aborting the batch.
 */
export function buildTransactionDrafts(input: BuildDraftsInput): BuildDraftsResult {
  const drafts: TransactionDraft[] = [];
  const errors: RowError[] = [];
  const occurrenceCounts = new Map<string, number>();

  input.rows.forEach((row, rowIndex) => {
    try {
      const fields = applyMapping(row, input.mapping);
      const merchant = normalizeMerchant(fields.rawDescription);

      const baseKey = [
        input.accountId,
        fields.bookedAt,
        fields.amountMinor,
        canonicalDesc(fields.rawDescription),
      ].join("|");
      const occurrence = occurrenceCounts.get(baseKey) ?? 0;
      occurrenceCounts.set(baseKey, occurrence + 1);

      const dedupHash = computeDedupHash({
        accountId: input.accountId,
        bookedAt: fields.bookedAt,
        amountMinor: fields.amountMinor,
        rawDescription: fields.rawDescription,
        occurrence,
      });

      const categoryId = categorizeByRules(fields.rawDescription, merchant, input.rules);

      drafts.push({
        bookedAt: fields.bookedAt,
        amountMinor: fields.amountMinor,
        currency: fields.currency,
        rawDescription: fields.rawDescription,
        merchant,
        dedupHash,
        categoryId,
        categorySource: categoryId ? "rule" : "uncategorized",
      });
    } catch (err) {
      errors.push({ rowIndex, message: err instanceof Error ? err.message : String(err) });
    }
  });

  return { drafts, errors };
}
