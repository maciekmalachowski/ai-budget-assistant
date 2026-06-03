import { describe, it, expect } from "vitest";
import { buildMapping, mappingToRoles } from "@/lib/csv/roles";
import type { ColumnMapping } from "@/lib/domain/types";

const base = { dateFormat: "DD-MM-YYYY" as const, decimalSep: "," as const, defaultCurrency: "PLN" };

describe("buildMapping", () => {
  it("builds a signed mapping from role assignments", () => {
    const mapping = buildMapping({
      ...base,
      roles: { 0: "date", 2: "description", 3: "description", 5: "amount" },
    });
    expect(mapping).toEqual({
      dateColumn: "Column 1",
      dateFormat: "DD-MM-YYYY",
      descriptionColumns: ["Column 3", "Column 4"],
      amount: { mode: "signed", amountColumn: "Column 6" },
      decimalSep: ",",
      currencyColumn: undefined,
      defaultCurrency: "PLN",
    });
  });
  it("builds a debit/credit mapping and reads a currency column", () => {
    const mapping = buildMapping({
      ...base,
      roles: { 0: "date", 2: "description", 4: "currency", 5: "debit", 6: "credit" },
    });
    expect(mapping?.amount).toEqual({ mode: "debit_credit", debitColumn: "Column 6", creditColumn: "Column 7" });
    expect(mapping?.currencyColumn).toBe("Column 5");
  });
  it("returns null when a required role is missing", () => {
    expect(buildMapping({ ...base, roles: { 2: "description", 5: "amount" } })).toBeNull(); // no date
    expect(buildMapping({ ...base, roles: { 0: "date", 5: "amount" } })).toBeNull(); // no description
    expect(buildMapping({ ...base, roles: { 0: "date", 2: "description", 5: "debit" } })).toBeNull(); // credit missing
  });
});

describe("mappingToRoles", () => {
  it("inverts a signed mapping back to per-column roles", () => {
    const mapping: ColumnMapping = {
      dateColumn: "Column 1",
      dateFormat: "DD-MM-YYYY",
      descriptionColumns: ["Column 3", "Column 4"],
      amount: { mode: "signed", amountColumn: "Column 6" },
      decimalSep: ",",
      defaultCurrency: "PLN",
    };
    expect(mappingToRoles(mapping)).toEqual({ 0: "date", 2: "description", 3: "description", 5: "amount" });
  });
});
