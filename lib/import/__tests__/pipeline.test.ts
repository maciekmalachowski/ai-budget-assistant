// @vitest-environment node
// (needs node:fs to read fixture files; the global vitest env is jsdom)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildTransactionDrafts } from "@/lib/import/pipeline";
import { parseCsvBuffer } from "@/lib/csv/parse";
import type { ColumnMapping, MerchantRule } from "@/lib/domain/types";

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
});
