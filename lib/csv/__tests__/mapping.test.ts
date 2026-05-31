import { describe, it, expect } from "vitest";
import { applyMapping } from "@/lib/csv/mapping";
import type { ColumnMapping, RawRow } from "@/lib/domain/types";

const signedMapping: ColumnMapping = {
  dateColumn: "Data operacji",
  dateFormat: "DD.MM.YYYY",
  descriptionColumns: ["Opis operacji"],
  amount: { mode: "signed", amountColumn: "Kwota" },
  decimalSep: ",",
  defaultCurrency: "PLN",
};

describe("applyMapping (signed)", () => {
  it("maps a row to normalized fields", () => {
    const row: RawRow = {
      "Data operacji": "12.05.2026",
      "Opis operacji": "BIEDRONKA 1234 WARSZAWA",
      "Kwota": "-87,40",
      "Saldo po operacji": "3 912,55",
    };
    expect(applyMapping(row, signedMapping)).toEqual({
      bookedAt: "2026-05-12",
      amountMinor: -8740,
      currency: "PLN",
      rawDescription: "BIEDRONKA 1234 WARSZAWA",
    });
  });
  it("throws when a mapped column is missing", () => {
    const row: RawRow = { "Opis operacji": "X", "Kwota": "-1,00" };
    expect(() => applyMapping(row, signedMapping)).toThrow(/Data operacji/);
  });
});

describe("applyMapping (debit/credit + multi-column description + currency)", () => {
  const mapping: ColumnMapping = {
    dateColumn: "Date",
    dateFormat: "YYYY-MM-DD",
    descriptionColumns: ["Payee", "Memo"],
    amount: { mode: "debit_credit", debitColumn: "Debit", creditColumn: "Credit" },
    decimalSep: ".",
    currencyColumn: "Currency",
    defaultCurrency: "PLN",
  };
  it("combines debit/credit, joins descriptions, and reads currency", () => {
    const row: RawRow = {
      Date: "2026-05-11",
      Payee: "ACME",
      Memo: "Salary",
      Debit: "",
      Credit: "9,500.00",
      Currency: "EUR",
    };
    expect(applyMapping(row, mapping)).toEqual({
      bookedAt: "2026-05-11",
      amountMinor: 950000,
      currency: "EUR",
      rawDescription: "ACME Salary",
    });
  });
  it("falls back to defaultCurrency when the currency cell is empty", () => {
    const row: RawRow = { Date: "2026-05-11", Payee: "ACME", Memo: "", Debit: "10.00", Credit: "", Currency: "" };
    expect(applyMapping(row, mapping).currency).toBe("PLN");
  });
});
