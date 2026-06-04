// @vitest-environment node
// (needs node:fs to read fixture files; the global vitest env is jsdom)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildTransactionDrafts } from "@/lib/import/pipeline";
import { parseCsvBuffer } from "@/lib/csv/parse";
import type { ColumnMapping, MerchantRule, RawRow } from "@/lib/domain/types";

const mapping: ColumnMapping = {
  dateColumn: "Data operacji",
  dateFormat: "DD.MM.YYYY",
  descriptionColumns: ["Opis operacji"],
  amount: { mode: "signed", amountColumn: "Kwota" },
  decimalSep: ",",
  defaultCurrency: "PLN",
};

const rules: MerchantRule[] = [
  { matchType: "contains", pattern: "BIEDRONKA", categoryId: "groceries" },
  { matchType: "regex", pattern: "UBER", categoryId: "transport" },
  { matchType: "contains", pattern: "NETFLIX", categoryId: "subs" },
];

describe("buildTransactionDrafts", () => {
  it("builds drafts from the parsed sample fixture and applies rules", () => {
    const { rows } = parseCsvBuffer(
      readFileSync(new URL("../../csv/__tests__/fixtures/mbank-sample.csv", import.meta.url)),
    );
    const { drafts, errors } = buildTransactionDrafts({ accountId: "acc-1", rows, mapping, rules });

    expect(errors).toEqual([]);
    expect(drafts).toHaveLength(4);

    expect(drafts[0]).toMatchObject({
      bookedAt: "2026-05-12",
      amountMinor: -8740,
      currency: "PLN",
      merchant: "BIEDRONKA WARSZAWA",
      categoryId: "groceries",
      categorySource: "rule",
    });
    expect(drafts[0].dedupHash).toMatch(/^[0-9a-f]{64}$/);

    // SALARY row matches no rule.
    expect(drafts[2]).toMatchObject({ amountMinor: 950000, categoryId: null, categorySource: "uncategorized" });
    // UBER + NETFLIX categorized.
    expect(drafts[1].categoryId).toBe("transport");
    expect(drafts[3].categoryId).toBe("subs");
  });

  it("captures per-row errors without aborting the batch", () => {
    const rows = [
      { "Data operacji": "12.05.2026", "Opis operacji": "OK SHOP", "Kwota": "-10,00" },
      { "Data operacji": "BAD", "Opis operacji": "BROKEN", "Kwota": "-5,00" },
      { "Data operacji": "13.05.2026", "Opis operacji": "FINE", "Kwota": "-1,00" },
    ];
    const { drafts, errors } = buildTransactionDrafts({ accountId: "acc-1", rows, mapping, rules });
    expect(drafts).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0].rowIndex).toBe(1);
  });

  it("gives identical same-day rows distinct hashes via occurrence index", () => {
    const dup = { "Data operacji": "12.05.2026", "Opis operacji": "KIOSK", "Kwota": "-3,00" };
    const { drafts } = buildTransactionDrafts({ accountId: "acc-1", rows: [dup, { ...dup }], mapping, rules });
    expect(drafts).toHaveLength(2);
    expect(drafts[0].dedupHash).not.toBe(drafts[1].dedupHash);
  });

  it("extracts the brand merchant from a card-payment description", () => {
    const rows = [
      {
        "Data operacji": "31.05.2026",
        "Opis operacji": "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 12.48 PLN eLeclerc 01 Gdansk",
        "Kwota": "-12,48",
      },
    ];
    const { drafts } = buildTransactionDrafts({ accountId: "acc-1", rows, mapping, rules });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].merchant).toBe("ELECLERC");
  });
});

const SANTANDER: ColumnMapping = {
  dateColumn: "Column 1",
  dateFormat: "DD-MM-YYYY",
  descriptionColumns: ["Column 3"],
  counterpartyColumn: "Column 4",
  counterpartyAccountColumn: "Column 5",
  amount: { mode: "signed", amountColumn: "Column 6" },
  decimalSep: ",",
  defaultCurrency: "PLN",
};

const santanderRow = (c3: string, c4: string, c5: string, c6: string): RawRow => ({
  "Column 1": "31-05-2026",
  "Column 3": c3,
  "Column 4": c4,
  "Column 5": c5,
  "Column 6": c6,
});

describe("buildTransactionDrafts — Santander types", () => {
  it("recovers the payee name and tags the type for a phone transfer", () => {
    const { drafts } = buildTransactionDrafts({
      accountId: "acc-1",
      rows: [santanderRow("Przelew na telefon Od: 48604263864 Do: 485*****130", "JULIA ZAKRZEWSKA", "PL18 1020 1752 0000 0102 0167 4100", "70,00")],
      mapping: SANTANDER,
      rules: [],
    });
    expect(drafts[0].merchant).toBe("Julia Zakrzewska");
    expect(drafts[0].txnType).toBe("transfer");
    expect(drafts[0].rawDescription).toContain("JULIA ZAKRZEWSKA");
  });

  it("extracts the brand and tags 'card' for a card payment", () => {
    const { drafts } = buildTransactionDrafts({
      accountId: "acc-1",
      rows: [santanderRow("DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 3.39 PLN ALDI SP. Z O.O. 06 GDANSK", "", "", "-3,39")],
      mapping: SANTANDER,
      rules: [],
    });
    expect(drafts[0].merchant).toBe("ALDI");
    expect(drafts[0].txnType).toBe("card");
  });

  it("skips the Santander preamble row (wrong date format) as an error, still importing real rows", () => {
    // Row 0 is the export's summary/preamble: col 1 in YYYY-MM-DD, col 3 = own account number.
    const preamble: RawRow = {
      "Column 1": "2026-05-31",
      "Column 3": "08109025900000000141981663",
      "Column 4": "",
      "Column 5": "PLN",
      "Column 6": "141",
    };
    const real = santanderRow("DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 5.99 PLN ZABKA Z9241 K.1 GDANSK", "", "", "-5,99");
    const { drafts, errors } = buildTransactionDrafts({
      accountId: "acc-1",
      rows: [preamble, real],
      mapping: SANTANDER,
      rules: [{ matchType: "contains", pattern: "ZABKA", categoryId: "groceries" }],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].rowIndex).toBe(0); // the preamble
    expect(drafts).toHaveLength(1); // only the real card row
    expect(drafts[0].merchant).toContain("ZABKA");
    expect(drafts[0].categoryId).toBe("groceries");
  });
});
