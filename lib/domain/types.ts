/** Date layouts we support parsing from bank exports. */
export type DateFormat =
  | "DD.MM.YYYY"
  | "DD-MM-YYYY"
  | "YYYY-MM-DD"
  | "DD/MM/YYYY"
  | "MM/DD/YYYY";

/** Text encodings we decode CSV buffers from. */
export type SupportedEncoding = "utf-8" | "win1250";

/** How a transaction's category was decided. */
export type CategorySource = "rule" | "ai" | "user" | "uncategorized";

/** A parsed CSV row keyed by (trimmed) header name. */
export type RawRow = Record<string, string>;

/** How the signed amount is derived from the CSV. */
export type AmountMapping =
  | { mode: "signed"; amountColumn: string }
  | { mode: "debit_credit"; debitColumn: string; creditColumn: string };

/** Maps a specific bank's CSV columns onto our fields. */
export interface ColumnMapping {
  dateColumn: string;
  dateFormat: DateFormat;
  /** One or more columns joined (space-separated) into the description. */
  descriptionColumns: string[];
  amount: AmountMapping;
  decimalSep: "," | ".";
  /** Optional currency column; falls back to defaultCurrency when absent/empty. */
  currencyColumn?: string;
  defaultCurrency: string;
}

/** Normalized fields extracted from a single CSV row. */
export interface MappedFields {
  /** ISO date, "YYYY-MM-DD". */
  bookedAt: string;
  /** Signed integer minor units (negative = outflow, positive = inflow). */
  amountMinor: number;
  currency: string;
  rawDescription: string;
}

/** A learned/seeded categorization rule (merchant_map row). */
export interface MerchantRule {
  matchType: "exact" | "contains" | "regex";
  pattern: string;
  categoryId: string;
}

/** A ready-to-persist transaction (before DB insert / dedup against existing rows). */
export interface TransactionDraft {
  bookedAt: string;
  amountMinor: number;
  currency: string;
  rawDescription: string;
  merchant: string;
  dedupHash: string;
  categoryId: string | null;
  categorySource: CategorySource;
}

/** A row that failed to parse, reported without aborting the batch. */
export interface RowError {
  rowIndex: number;
  message: string;
}
