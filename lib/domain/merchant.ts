/**
 * Pure helpers (no I/O) for deriving a clean display name (brand or payee) from a noisy
 * Santander bank-statement row. Extraction is transaction-type-aware: card lines carry the
 * merchant in the title; BLIK and transfers carry it in the counterparty column.
 */
import type { TxnType } from "@/lib/domain/types";

const CARD_MASK = /\b\d+\*+\d+\b/g;
const AMOUNT_CCY = /\b\d+[.,]\d{2}\s+(?:PLN|EUR|USD|GBP|CZK)\b/giu;
const BOILERPLATE = /\b(?:DOP|VISA|MASTERCARD|MAESTRO|ZWROT|P[ŁL]ATNO[ŚS][ĆC]I?|KART[ĄA])\b\.?/giu;
const LONE_CCY = /\b(?:PLN|EUR|USD|GBP|CZK)\b/giu;
const LONG_DIGITS = /\b\d{4,}\b/g;

/** Card payment: "… PŁATNOŚĆ KARTĄ <amount> <CCY> <merchant>" (also "ZWROT PŁATNOŚCI KARTĄ"). */
function cardMerchant(title: string): string | null {
  const m = title.match(/P[ŁL]ATNO[ŚS][ĆC]I?\s+KART[ĄA]\s+[\d.,]+\s+[A-Za-z]{3}\s+(.+)$/u);
  return m ? m[1] : null;
}

/** BLIK title: text between "BLIK" and "ref:". */
function blikMerchant(title: string): string | null {
  const m = title.match(/\bBLIK\b\s+(?:na telefon\s+)?(.+?)(?:\s+ref:|$)/iu);
  return m ? m[1] : null;
}

/** Strip card/amount/boilerplate noise from a line, keep whatever remains. */
function genericClean(raw: string): string {
  return raw
    .replace(CARD_MASK, " ")
    .replace(AMOUNT_CCY, " ")
    .replace(BOILERPLATE, " ")
    .replace(LONE_CCY, " ")
    .replace(LONG_DIGITS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// NOTE: the two spelled-out alternatives end with a Polish diacritic (…ODPOWIEDZIALNOŚCIĄ,
// …AKCYJNA); a trailing \b fails there because JS treats letters like "Ą" as non-word for
// boundary purposes, so we anchor those with a (?=\s|$) lookahead instead.
const LEGAL_SUFFIX =
  /\bSP[ÓO][ŁL]KA\s+Z\s+OGRANICZON[ĄA]\s+ODPOWIEDZIALNO[ŚS]CI[ĄA](?=\s|$)|\bSP[ÓO][ŁL]KA\s+AKCYJNA(?=\s|$)|\bSP\.?\s*Z\s*O\.?\s*O\.?\b|\bS\.?\s*A\.?\b|\bSP\.?\s*J\.?\b|\bSP\.?\s*K\.?\b/giu;
/** A trailing "<1-3 digit store#> <CITY/word>" at the end of the name. */
const TRAILING_STORE_CITY = /\s+\d{1,3}\s+[\p{L}][\p{L}.-]*$/u;

/** Collapse an extracted name to its brand: uppercase, drop legal suffixes + trailing store#/city. */
export function brandNormalize(name: string): string {
  const upper = name.toUpperCase().replace(/\s+/g, " ").trim();
  let s = upper.replace(LEGAL_SUFFIX, " ").replace(/\s+/g, " ").trim();
  s = s.replace(TRAILING_STORE_CITY, "").trim();
  s = s.replace(/[.\s]+$/, "").trim();
  return s === "" ? upper : s;
}

/**
 * The brand portion of a counterparty (payee) field, which has the form
 * "<BRAND> <LEGAL-FORM> <ADDRESS>" — everything from the legal form onward is dropped.
 * Returns null when there's no legal-form marker (so callers keep the whole name).
 */
function counterpartyBrand(cp: string): string | null {
  const idx = cp.search(LEGAL_SUFFIX);
  return idx > 0 ? cp.slice(0, idx).trim() : null;
}

const STREET_MARKER = /\b(?:UL|AL|PL|OS|ULICA|ALEJA|OSIEDLE)\b\.?.*$/iu;

/** Drop a trailing street address / postcode / "ELIXIR <date>" tail from a counterparty name. */
function stripCounterpartyAddress(s: string): string {
  let out = s.replace(/\bELIXIR\b.*$/iu, " "); // settlement-system tail
  out = out.replace(STREET_MARKER, " "); // "UL. KROKUSOWA 9 …", "ALEJA GRUNWALDZKA …"
  out = out.replace(/\s\d.*$/u, " "); // cut from the first standalone number onward
  return out.replace(/\s+/g, " ").trim();
}

/** Title-case a (possibly ALL-CAPS) person/company name, diacritics preserved. */
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Clean a counterparty to a display name: strip address + legal form, Title-Case. */
function cleanCounterparty(cp: string): string {
  // A company name ("<BRAND> <LEGAL-FORM> <ADDRESS>") — keep only the brand before the legal form.
  const brand = counterpartyBrand(cp);
  if (brand) return titleCase(brand);
  // A person ("JAN KOWALSKI UL. … <postcode>") — strip the address tail, then Title-Case.
  const noAddr = stripCounterpartyAddress(cp);
  return titleCase(noAddr) || cp.trim();
}

/**
 * Derive a clean display name for a transaction. `card`/`fee` read the title; `blik` prefers the
 * counterparty (falling back to the BLIK title segment); `transfer`/`internal` use the counterparty
 * name. Never returns an empty string.
 */
export function extractMerchant(type: TxnType, title: string, counterparty: string): string {
  const cp = counterparty.trim();
  switch (type) {
    case "blik": {
      const source = cp || blikMerchant(title) || genericClean(title);
      return brandNormalize(counterpartyBrand(source) ?? source);
    }
    case "transfer":
    case "internal":
      if (cp) return cleanCounterparty(cp);
      return brandNormalize(genericClean(title));
    case "card":
    case "fee":
    default:
      return brandNormalize(cardMerchant(title) ?? genericClean(title));
  }
}
