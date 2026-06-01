/**
 * A flattened transaction row used by the pure aggregation layer.
 * `amountMinor` is signed integer minor units (negative = outflow, positive = inflow).
 * `categoryName` is the joined category name, or null when uncategorized.
 */
export interface TxnRow {
  amountMinor: number;
  merchant: string | null;
  currency: string;
  categoryName: string | null;
}
