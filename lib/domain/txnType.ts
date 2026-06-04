import type { TxnType } from "@/lib/domain/types";

/** Card payment line, e.g. "DOP. VISA … PŁATNOŚĆ KARTĄ …" (incl. "ZWROT PŁATNOŚCI KARTĄ"). */
const CARD_RE = /\bP[ŁL]ATNO[ŚS][ĆC]\s+KART[ĄA]\b|\bKART[ĄA]\b.*\bPLN\b|^DOP\.?\s+VISA\b/iu;
/** BLIK line: "Zakup BLIK …", "Zwrot BLIK …", "Przelew BLIK …". */
const BLIK_RE = /\bBLIK\b/iu;
/** Own-account transfer label Santander uses. */
const INTERNAL_RE = /\bBETWEEN YOUR OWN ACCOUNTS\b|\bPRZELEW W[ŁL]ASNY\b/iu;
/** Bank-posted fee/interest lines (no counterparty). */
const FEE_RE = /^(UZNANIE|OBCI[ĄA][ŻZ]ENIE)\b/iu;

/**
 * Infer the coarse transaction type from the title (and whether a counterparty is present).
 * Order matters: card and BLIK prefixes win over the generic "has-counterparty → transfer".
 */
export function classifyTransaction(title: string, counterparty: string): TxnType {
  const t = title.trim();
  if (CARD_RE.test(t)) return "card";
  if (BLIK_RE.test(t)) return "blik";
  if (INTERNAL_RE.test(t)) return "internal";
  if (FEE_RE.test(t) && counterparty.trim() === "") return "fee";
  return "transfer";
}
