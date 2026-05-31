export interface AmountParseOptions {
  decimalSep: "," | ".";
  /** Minor-unit decimal places (default 2). */
  decimals?: number;
}

/** Parse a localized money string into signed integer minor units. */
export function parseAmount(raw: string, opts: AmountParseOptions): number {
  const decimals = opts.decimals ?? 2;
  let s = raw.trim();
  if (s === "") throw new Error("Empty amount");

  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }

  // Remove all whitespace (incl. non-breaking space) used as thousands separators.
  s = s.replace(/[\s ]/g, "");
  if (opts.decimalSep === ",") {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }

  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Unparseable amount: "${raw}"`);
  }
  const minor = Math.round(Number(s) * 10 ** decimals);
  return sign * minor;
}

/** Combine a bank's separate debit/credit columns into one signed minor-unit value. */
export function combineDebitCredit(
  debitRaw: string,
  creditRaw: string,
  opts: AmountParseOptions,
): number {
  const d = debitRaw.trim();
  const c = creditRaw.trim();
  const dv = d === "" ? 0 : parseAmount(d, opts);
  const cv = c === "" ? 0 : parseAmount(c, opts);
  if (dv === 0 && cv === 0) {
    throw new Error("Both debit and credit are empty or zero");
  }
  if (dv !== 0 && cv !== 0) {
    throw new Error("Both debit and credit are non-zero");
  }
  return dv !== 0 ? -Math.abs(dv) : Math.abs(cv);
}
