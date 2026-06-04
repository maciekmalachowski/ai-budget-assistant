import { createHash } from "node:crypto";

/** Whitespace/case-insensitive canonical form of a description, for stable hashing. */
export function canonicalizeForHash(rawDescription: string): string {
  return rawDescription.toUpperCase().replace(/\s+/g, " ").trim();
}

export interface DedupHashInput {
  accountId: string;
  bookedAt: string;
  amountMinor: number;
  rawDescription: string;
  /** 0-based index among otherwise-identical rows in the same import batch. */
  occurrence: number;
}

/** Deterministic per-account dedup key: hash(account|date|amount|canonicalDesc|occurrence). */
export function computeDedupHash(input: DedupHashInput): string {
  const canonical = JSON.stringify([
    input.accountId,
    input.bookedAt,
    input.amountMinor,
    canonicalizeForHash(input.rawDescription),
    input.occurrence,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** The title-derived fields a transaction's dedup hash is keyed on (a subset of MappedFields). */
export interface TitleDedupFields {
  bookedAt: string;
  amountMinor: number;
  /** The title/note join — the dedup-hash basis, kept stable across the extraction change. */
  title: string;
}

/**
 * The per-batch occurrence-map key for a row: JSON of [accountId, date, amount, canonical(title)].
 * Identical-but-repeated rows in one batch share this key; the count becomes the `occurrence`
 * index fed to {@link titleDedupHash}. The importer and CSV-enrich MUST use the same key/hash or
 * dedup silently breaks, so both derive them here.
 */
export function titleDedupBaseKey(accountId: string, fields: TitleDedupFields): string {
  return JSON.stringify([accountId, fields.bookedAt, fields.amountMinor, canonicalizeForHash(fields.title)]);
}

/** The dedup hash for a row, keyed on the (stable) title rather than the enriched description. */
export function titleDedupHash(accountId: string, fields: TitleDedupFields, occurrence: number): string {
  return computeDedupHash({
    accountId,
    bookedAt: fields.bookedAt,
    amountMinor: fields.amountMinor,
    rawDescription: fields.title,
    occurrence,
  });
}
