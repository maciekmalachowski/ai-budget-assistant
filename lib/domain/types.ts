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

/** Coarse transaction type, inferred from the row, that drives merchant extraction. */
export type TxnType = "card" | "blik" | "transfer" | "internal" | "fee";

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
  /** Optional counterparty (payee) name column — used for transfers and BLIK. */
  counterpartyColumn?: string;
  /** Optional counterparty bank-account column. */
  counterpartyAccountColumn?: string;
  defaultCurrency: string;
}

/** Normalized fields extracted from a single CSV row. */
export interface MappedFields {
  /** ISO date, "YYYY-MM-DD". */
  bookedAt: string;
  /** Signed integer minor units (negative = outflow, positive = inflow). */
  amountMinor: number;
  currency: string;
  /** The title/note column(s) joined — the dedup-hash basis (kept stable). */
  title: string;
  /** Counterparty (payee) name, or "" when not mapped. */
  counterparty: string;
  /** Counterparty bank-account number, or "" when not mapped. */
  counterpartyAccount: string;
  /** Full reconstructed line (title + counterparty + account) for display/search. */
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
  /** Structured fields kept alongside rawDescription for richer display; set by the import pipeline. */
  title?: string;
  counterparty?: string;
  counterpartyAccount?: string;
  /** Transient: drives AI-rule learning; not persisted to the DB. */
  txnType?: TxnType;
  dedupHash: string;
  categoryId: string | null;
  categorySource: CategorySource;
  /** Model confidence (0..1) when categorySource is "ai"; otherwise absent/null. */
  aiConfidence?: number | null;
}

/** A row that failed to parse, reported without aborting the batch. */
export interface RowError {
  rowIndex: number;
  message: string;
}
