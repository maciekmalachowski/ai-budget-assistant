import type { ColumnMapping, MappedFields, RawRow } from "@/lib/domain/types";
import { parseDate } from "@/lib/domain/dates";
import { parseAmount, combineDebitCredit } from "@/lib/domain/money";

function requireColumn(row: RawRow, col: string): string {
  if (!(col in row)) throw new Error(`Missing column "${col}"`);
  return row[col] ?? "";
}

/** Turn one raw CSV row into normalized fields using a bank's column mapping. */
export function applyMapping(row: RawRow, mapping: ColumnMapping): MappedFields {
  const bookedAt = parseDate(requireColumn(row, mapping.dateColumn), mapping.dateFormat);

  let amountMinor: number;
  if (mapping.amount.mode === "signed") {
    amountMinor = parseAmount(requireColumn(row, mapping.amount.amountColumn), {
      decimalSep: mapping.decimalSep,
    });
  } else {
    amountMinor = combineDebitCredit(
      requireColumn(row, mapping.amount.debitColumn),
      requireColumn(row, mapping.amount.creditColumn),
      { decimalSep: mapping.decimalSep },
    );
  }

  const rawDescription = mapping.descriptionColumns
    .map((c) => requireColumn(row, c).trim())
    .filter((v) => v !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const currency = mapping.currencyColumn
    ? requireColumn(row, mapping.currencyColumn).trim() || mapping.defaultCurrency
    : mapping.defaultCurrency;

  return { bookedAt, amountMinor, currency, rawDescription };
}
