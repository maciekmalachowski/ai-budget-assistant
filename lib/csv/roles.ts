import type { ColumnMapping, DateFormat } from "@/lib/domain/types";
import { columnKey, columnIndex } from "@/lib/csv/parse";

export type ColumnRole =
  | "ignore"
  | "date"
  | "description"
  | "amount"
  | "debit"
  | "credit"
  | "currency"
  | "counterparty"
  | "counterpartyAccount";

export interface MappingDraft {
  /** Role chosen per column index (0-based); absent columns are treated as "ignore". */
  roles: Record<number, ColumnRole>;
  dateFormat: DateFormat;
  decimalSep: "," | ".";
  defaultCurrency: string;
}

function indicesWithRole(roles: Record<number, ColumnRole>, role: ColumnRole): number[] {
  return Object.keys(roles)
    .map(Number)
    .filter((i) => roles[i] === role)
    .sort((a, b) => a - b);
}

function firstWithRole(roles: Record<number, ColumnRole>, role: ColumnRole): number | null {
  const hits = indicesWithRole(roles, role);
  return hits.length > 0 ? hits[0] : null;
}

/**
 * Translate per-column role assignments into a ColumnMapping, or null when the
 * required roles are missing (need a date, ≥1 description, and either a single
 * amount column or both a debit and a credit column).
 */
export function buildMapping(draft: MappingDraft): ColumnMapping | null {
  const dateIdx = firstWithRole(draft.roles, "date");
  const descIdx = indicesWithRole(draft.roles, "description");
  const amountIdx = firstWithRole(draft.roles, "amount");
  const debitIdx = firstWithRole(draft.roles, "debit");
  const creditIdx = firstWithRole(draft.roles, "credit");
  const currencyIdx = firstWithRole(draft.roles, "currency");
  const counterpartyIdx = firstWithRole(draft.roles, "counterparty");
  const counterpartyAccountIdx = firstWithRole(draft.roles, "counterpartyAccount");

  if (dateIdx === null || descIdx.length === 0) return null;

  let amount: ColumnMapping["amount"];
  if (amountIdx !== null) {
    amount = { mode: "signed", amountColumn: columnKey(amountIdx) };
  } else if (debitIdx !== null && creditIdx !== null) {
    amount = { mode: "debit_credit", debitColumn: columnKey(debitIdx), creditColumn: columnKey(creditIdx) };
  } else {
    return null;
  }

  return {
    dateColumn: columnKey(dateIdx),
    dateFormat: draft.dateFormat,
    descriptionColumns: descIdx.map(columnKey),
    amount,
    decimalSep: draft.decimalSep,
    currencyColumn: currencyIdx !== null ? columnKey(currencyIdx) : undefined,
    counterpartyColumn: counterpartyIdx !== null ? columnKey(counterpartyIdx) : undefined,
    counterpartyAccountColumn: counterpartyAccountIdx !== null ? columnKey(counterpartyAccountIdx) : undefined,
    defaultCurrency: draft.defaultCurrency,
  };
}

/** Invert a ColumnMapping into per-column roles, to seed the grid from a guess/profile. */
export function mappingToRoles(mapping: ColumnMapping): Record<number, ColumnRole> {
  const roles: Record<number, ColumnRole> = {};
  const set = (key: string, role: ColumnRole) => {
    const i = columnIndex(key);
    if (i >= 0) roles[i] = role;
  };
  set(mapping.dateColumn, "date");
  mapping.descriptionColumns.forEach((c) => set(c, "description"));
  if (mapping.amount.mode === "signed") {
    set(mapping.amount.amountColumn, "amount");
  } else {
    set(mapping.amount.debitColumn, "debit");
    set(mapping.amount.creditColumn, "credit");
  }
  if (mapping.currencyColumn) set(mapping.currencyColumn, "currency");
  if (mapping.counterpartyColumn) set(mapping.counterpartyColumn, "counterparty");
  if (mapping.counterpartyAccountColumn) set(mapping.counterpartyAccountColumn, "counterpartyAccount");
  return roles;
}
