import { createHash } from "node:crypto";

/** Derive a clean, display-friendly merchant name from a raw bank description. */
export function normalizeMerchant(rawDescription: string): string {
  return rawDescription
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((tok) => tok !== "" && !/^\d{4,}$/.test(tok))
    .join(" ")
    .trim();
}

/** Whitespace/case-insensitive canonical form of a description, for stable hashing. */
function canonicalizeForHash(rawDescription: string): string {
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
  const canonical = [
    input.accountId,
    input.bookedAt,
    String(input.amountMinor),
    canonicalizeForHash(input.rawDescription),
    String(input.occurrence),
  ].join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
