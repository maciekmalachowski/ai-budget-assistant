import type { ColumnMapping, DateFormat } from "@/lib/domain/types";
import { parseDate } from "@/lib/domain/dates";
import { parseAmount } from "@/lib/domain/money";
import { columnKey, columnIndex } from "@/lib/csv/parse";

const DATE_FORMATS: DateFormat[] = ["DD-MM-YYYY", "DD.MM.YYYY", "YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"];
const DECIMAL_SEPS: Array<"," | "."> = [",", "."];
const PARSE_THRESHOLD = 0.8;

function parsesAsDate(cell: string, fmt: DateFormat): boolean {
  try {
    parseDate(cell, fmt);
    return true;
  } catch {
    return false;
  }
}

function parsesAsAmount(cell: string, sep: "," | "."): boolean {
  if (cell.trim() === "") return false;
  try {
    parseAmount(cell, { decimalSep: sep });
    return true;
  } catch {
    return false;
  }
}

function column(rows: string[][], index: number): string[] {
  return rows.map((r) => r[index] ?? "");
}

function nonEmpty(cells: string[]): string[] {
  return cells.filter((c) => c.trim() !== "");
}

/** Fraction (0..1) of non-empty cells satisfying `pred`; 0 when the column is empty. */
function fractionMatching(cells: string[], pred: (c: string) => boolean): number {
  const present = nonEmpty(cells);
  if (present.length === 0) return 0;
  return present.filter(pred).length / present.length;
}

/**
 * Leftmost column whose best date-format match meets the threshold, with that
 * format. Leftmost-wins is deliberate: the booking-date column (often col 0) is
 * what exposes an account-info preamble that shares the value-date column.
 */
export function guessDateColumn(rows: string[][], columns: number): { index: number; format: DateFormat } | null {
  for (let i = 0; i < columns; i++) {
    const cells = column(rows, i);
    let best: { format: DateFormat; score: number } | null = null;
    for (const fmt of DATE_FORMATS) {
      const score = fractionMatching(cells, (c) => parsesAsDate(c, fmt));
      if (best === null || score > best.score) best = { format: fmt, score };
    }
    if (best && best.score >= PARSE_THRESHOLD) return { index: i, format: best.format };
  }
  return null;
}

/** Decimal separator that parses the most money-looking cells across all columns. */
export function guessDecimalSep(rows: string[][], columns: number): "," | "." {
  let best: "," | "." = ",";
  let bestCount = -1;
  for (const sep of DECIMAL_SEPS) {
    let count = 0;
    for (let i = 0; i < columns; i++) {
      for (const c of column(rows, i)) {
        if (c.includes(sep) && parsesAsAmount(c, sep)) count++;
      }
    }
    if (count > bestCount) {
      bestCount = count;
      best = sep;
    }
  }
  return best;
}

/**
 * Best amount column: among mostly-numeric columns (excluding the date column),
 * prefer one with a decimal separator and at least one negative value — this
 * distinguishes a signed amount column from a running balance or a row index.
 */
export function guessAmountColumn(rows: string[][], columns: number, sep: "," | ".", excludeIndex: number): number | null {
  let best: { index: number; score: number } | null = null;
  for (let i = 0; i < columns; i++) {
    if (i === excludeIndex) continue;
    const cells = column(rows, i);
    if (fractionMatching(cells, (c) => parsesAsAmount(c, sep)) < PARSE_THRESHOLD) continue;
    const present = nonEmpty(cells);
    const hasDecimal = present.some((c) => c.includes(sep));
    const hasNegative = present.some((c) => {
      try {
        return parseAmount(c, { decimalSep: sep }) < 0;
      } catch {
        return false;
      }
    });
    const score = (hasNegative ? 2 : 0) + (hasDecimal ? 1 : 0);
    if (best === null || score > best.score) best = { index: i, score };
  }
  return best ? best.index : null;
}

/**
 * Best mostly-text column (excluding given indices) → description. Scored by
 * fill rate × average length, so the column populated on every row (the real
 * description) beats a sparse column that happens to hold one long value (e.g. a
 * counterparty name/address present on only some rows).
 */
export function guessDescriptionColumn(rows: string[][], columns: number, exclude: number[]): number | null {
  let best: { index: number; score: number } | null = null;
  for (let i = 0; i < columns; i++) {
    if (exclude.includes(i)) continue;
    const cells = column(rows, i);
    const present = nonEmpty(cells);
    if (present.length === 0) continue;
    const numericish = present.filter((c) => /^[\d\s.,+\-/]+$/.test(c)).length / present.length;
    if (numericish >= 0.5) continue;
    const fillRate = present.length / cells.length;
    const avgLen = present.reduce((s, c) => s + c.trim().length, 0) / present.length;
    const score = fillRate * avgLen;
    if (best === null || score > best.score) best = { index: i, score };
  }
  return best ? best.index : null;
}

/** Auto-guess a full ColumnMapping from sampled rows (best-effort; the preview corrects it). */
export function guessMapping(rows: string[][], columns: number, defaultCurrency: string): ColumnMapping {
  const sep = guessDecimalSep(rows, columns);
  const date = guessDateColumn(rows, columns);
  const dateIdx = date?.index ?? 0;
  const amountIdx = guessAmountColumn(rows, columns, sep, dateIdx);
  const descIdx = guessDescriptionColumn(rows, columns, [dateIdx, ...(amountIdx !== null ? [amountIdx] : [])]);

  return {
    dateColumn: columnKey(dateIdx),
    dateFormat: date?.format ?? "YYYY-MM-DD",
    descriptionColumns: descIdx !== null ? [columnKey(descIdx)] : [],
    amount: { mode: "signed", amountColumn: columnKey(amountIdx ?? 0) },
    decimalSep: sep,
    defaultCurrency,
  };
}

/** Like detectStartRow, but returns null when no row parses as a transaction. */
export function findStartRow(rows: string[][], mapping: ColumnMapping): number | null {
  const dateIdx = columnIndex(mapping.dateColumn);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (dateIdx < 0 || !parsesAsDate(row[dateIdx] ?? "", mapping.dateFormat)) continue;
    let amountOk: boolean;
    if (mapping.amount.mode === "signed") {
      amountOk = parsesAsAmount(row[columnIndex(mapping.amount.amountColumn)] ?? "", mapping.decimalSep);
    } else {
      const d = row[columnIndex(mapping.amount.debitColumn)] ?? "";
      const c = row[columnIndex(mapping.amount.creditColumn)] ?? "";
      amountOk = parsesAsAmount(d, mapping.decimalSep) || parsesAsAmount(c, mapping.decimalSep);
    }
    if (amountOk) return i;
  }
  return null;
}

/**
 * Index of the first row that parses as a transaction under `mapping` (its date
 * cell parses in the mapped format AND its amount cell parses). Returns 0 when no
 * row qualifies — the UI then prompts the user to pick the start row manually.
 */
export function detectStartRow(rows: string[][], mapping: ColumnMapping): number {
  return findStartRow(rows, mapping) ?? 0;
}
