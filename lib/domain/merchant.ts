/**
 * Pure helpers (no I/O) for deriving a clean, brand-level merchant name from a raw
 * bank-statement description — tuned for noisy Polish card-payment lines.
 */

/** Returns the merchant portion of a raw description, or null if the extractor doesn't apply. */
type MerchantExtractor = (raw: string) => string | null;

/** Card payment: "... PŁATNOŚĆ KARTĄ <amount> <CCY> <merchant>". Diacritic-lenient. */
const cardExtractor: MerchantExtractor = (raw) => {
  const m = raw.match(/P[ŁL]ATNO[ŚS][ĆC]\s+KART[ĄA]\s+[\d.,]+\s+[A-Za-z]{3}\s+(.+)$/u);
  return m ? m[1] : null;
};

const CARD_MASK = /\b\d+\*+\d+\b/g;
const AMOUNT_CCY = /\b\d+[.,]\d{2}\s+(?:PLN|EUR|USD|GBP|CZK)\b/giu;
const BOILERPLATE = /\b(?:DOP|VISA|MASTERCARD|MAESTRO|P[ŁL]ATNO[ŚS][ĆC]|KART[ĄA])\b\.?/giu;
const LONE_CCY = /\b(?:PLN|EUR|USD|GBP|CZK)\b/giu;
const LONG_DIGITS = /\b\d{4,}\b/g;

/** Fallback: strip obvious card/amount/boilerplate noise, keep whatever remains. */
const genericExtractor: MerchantExtractor = (raw) =>
  raw
    .replace(CARD_MASK, " ")
    .replace(AMOUNT_CCY, " ")
    .replace(BOILERPLATE, " ")
    .replace(LONE_CCY, " ")
    .replace(LONG_DIGITS, " ")
    .replace(/\s+/g, " ")
    .trim();

const EXTRACTORS: MerchantExtractor[] = [cardExtractor, genericExtractor];

const LEGAL_SUFFIX =
  /\bSP\.?\s*Z\s*O\.?\s*O\.?\b|\bS\.?\s*A\.?\b|\bSP\.?\s*J\.?\b|\bSP\.?\s*K\.?\b/giu;
/** A trailing "<1-3 digit store#> <CITY/word>" at the end of the name. */
const TRAILING_STORE_CITY = /\s+\d{1,3}\s+[\p{L}][\p{L}.-]*$/u;

/** Collapse an extracted name to its brand: uppercase, drop legal suffixes + trailing store#/city. */
export function brandNormalize(name: string): string {
  const upper = name.toUpperCase().replace(/\s+/g, " ").trim();
  let s = upper.replace(LEGAL_SUFFIX, " ").replace(/\s+/g, " ").trim();
  s = s.replace(TRAILING_STORE_CITY, "").trim();
  // strip trailing punctuation that legal-suffix removal may have left behind
  s = s.replace(/[.\s]+$/, "").trim();
  return s === "" ? upper : s;
}

/**
 * Derive a clean, brand-level merchant from a raw bank description.
 * Tries each extractor in order (precise card matcher first), then brand-normalizes
 * the first non-empty result. Never returns an empty string.
 */
export function extractMerchant(raw: string): string {
  for (const extractor of EXTRACTORS) {
    const got = extractor(raw);
    if (got != null && got.trim() !== "") return brandNormalize(got);
  }
  return brandNormalize(raw);
}
