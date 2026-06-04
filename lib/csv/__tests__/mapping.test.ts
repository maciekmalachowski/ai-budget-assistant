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
      title: "BIEDRONKA 1234 WARSZAWA",
      counterparty: "",
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
      title: "ACME Salary",
      counterparty: "",
      rawDescription: "ACME Salary",
    });
  });
  it("falls back to defaultCurrency when the currency cell is empty", () => {
    const row: RawRow = { Date: "2026-05-11", Payee: "ACME", Memo: "", Debit: "10.00", Credit: "", Currency: "" };
    expect(applyMapping(row, mapping).currency).toBe("PLN");
  });
});

const CP_MAPPING: ColumnMapping = {
  dateColumn: "Column 1",
  dateFormat: "DD-MM-YYYY",
  descriptionColumns: ["Column 3"],
  counterpartyColumn: "Column 4",
  counterpartyAccountColumn: "Column 5",
  amount: { mode: "signed", amountColumn: "Column 6" },
  decimalSep: ",",
  defaultCurrency: "PLN",
};

const CP_ROW: RawRow = {
  "Column 1": "31-05-2026",
  "Column 2": "31-05-2026",
  "Column 3": "Przelew na telefon Od: 48604263864 Do: 485*****130",
  "Column 4": "JULIA ZAKRZEWSKA",
  "Column 5": "PL18 1020 1752 0000 0102 0167 4100",
  "Column 6": "70,00",
};

describe("applyMapping with counterparty", () => {
  it("captures title and counterparty separately", () => {
    const f = applyMapping(CP_ROW, CP_MAPPING);
    expect(f.title).toBe("Przelew na telefon Od: 48604263864 Do: 485*****130");
    expect(f.counterparty).toBe("JULIA ZAKRZEWSKA");
  });

  it("reconstructs raw_description from title + counterparty + account", () => {
    const f = applyMapping(CP_ROW, CP_MAPPING);
    expect(f.rawDescription).toContain("JULIA ZAKRZEWSKA");
    expect(f.rawDescription).toContain("Przelew na telefon");
    expect(f.rawDescription).toContain("PL18 1020 1752");
  });

  it("leaves counterparty empty when the column is unmapped", () => {
    const cardRow: RawRow = { ...CP_ROW, "Column 4": "", "Column 5": "" };
    const noCp: ColumnMapping = { ...CP_MAPPING, counterpartyColumn: undefined, counterpartyAccountColumn: undefined };
    const f = applyMapping(cardRow, noCp);
    expect(f.counterparty).toBe("");
    expect(f.rawDescription).toBe("Przelew na telefon Od: 48604263864 Do: 485*****130");
  });
});
