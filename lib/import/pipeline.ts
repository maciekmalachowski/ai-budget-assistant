import type {
  ColumnMapping,
  MerchantRule,
  RawRow,
  RowError,
  TransactionDraft,
} from "@/lib/domain/types";
import { applyMapping } from "@/lib/csv/mapping";
import { computeDedupHash, canonicalizeForHash } from "@/lib/domain/normalize";
import { extractMerchant } from "@/lib/domain/merchant";
import { classifyTransaction } from "@/lib/domain/txnType";
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
      const txnType = classifyTransaction(fields.title, fields.counterparty);
      const merchant = extractMerchant(txnType, fields.title, fields.counterparty);

      // Dedup hash is built from the TITLE (not the enriched rawDescription) to stay stable
      // across the extraction change and avoid duplicate explosions on re-import.
      const baseKey = JSON.stringify([
        input.accountId,
        fields.bookedAt,
        fields.amountMinor,
        canonicalizeForHash(fields.title),
      ]);
      const occurrence = occurrenceCounts.get(baseKey) ?? 0;
      occurrenceCounts.set(baseKey, occurrence + 1);

      const dedupHash = computeDedupHash({
        accountId: input.accountId,
        bookedAt: fields.bookedAt,
        amountMinor: fields.amountMinor,
        rawDescription: fields.title,
        occurrence,
      });

      // For person-to-person transfers the merchant IS the payee name and rawDescription embeds
      // it, so brand-keyword `contains`/`regex` rules collide; scope those to the note (title).
      const categoryId =
        txnType === "transfer" || txnType === "internal"
          ? categorizeByRules(fields.rawDescription, merchant, input.rules, { containsText: fields.title })
          : categorizeByRules(fields.rawDescription, merchant, input.rules);

      drafts.push({
        bookedAt: fields.bookedAt,
        amountMinor: fields.amountMinor,
        currency: fields.currency,
        rawDescription: fields.rawDescription,
        merchant,
        txnType,
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
