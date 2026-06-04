import { describe, it, expect } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { seedMerchantRules } from "@/lib/repos/merchantMap";
import { enrichFromCsv } from "@/lib/transactions/backfillMerchants";
import { insertDrafts } from "@/lib/repos/transactions";
import { computeDedupHash } from "@/lib/domain/normalize";
import type { ColumnMapping, RawRow } from "@/lib/domain/types";

const db = createAdminClient();
const MAPPING: ColumnMapping = {
  dateColumn: "Column 1", dateFormat: "DD-MM-YYYY", descriptionColumns: ["Column 3"],
  counterpartyColumn: "Column 4", counterpartyAccountColumn: "Column 5",
  amount: { mode: "signed", amountColumn: "Column 6" }, decimalSep: ",", defaultCurrency: "PLN",
};

async function makeAccount(): Promise<string> {
  const { data, error } = await db
    .from("accounts")
    .insert({ name: `t-${Date.now()}`, currency: "PLN" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

describe("enrichFromCsv (integration)", () => {
  it("recovers a transfer payee name on an existing row without duplicating", async () => {
    const accountId = await makeAccount();
    await seedMerchantRules(db);

    // Simulate an OLD import: title-only raw_description, hash built from the title.
    const title = "Przelew na telefon Od: 48604263864 Do: 485*****130";
    const dedupHash = computeDedupHash({ accountId, bookedAt: "2026-05-31", amountMinor: 7000, rawDescription: title, occurrence: 0 });
    await insertDrafts(db, accountId, null, [{
      bookedAt: "2026-05-31", amountMinor: 7000, currency: "PLN",
      rawDescription: title, merchant: "PRZELEW NA TELEFON OD DO",
      dedupHash, categoryId: null, categorySource: "uncategorized",
    }]);

    const row: RawRow = {
      "Column 1": "31-05-2026", "Column 3": title,
      "Column 4": "JULIA ZAKRZEWSKA", "Column 5": "PL18 1020 1752 0000 0102 0167 4100", "Column 6": "70,00",
    };
    const res = await enrichFromCsv(db, { accountId, rows: [row], mapping: MAPPING });
    expect(res.matched).toBe(1);
    expect(res.updated).toBe(1);

    const { data } = await db.from("transactions").select("merchant, raw_description").eq("account_id", accountId);
    expect(data!.length).toBe(1); // no duplicate created
    expect(data![0].merchant).toBe("Julia Zakrzewska");
    expect(data![0].raw_description).toContain("JULIA ZAKRZEWSKA");

    await db.from("transactions").delete().eq("account_id", accountId);
    await db.from("accounts").delete().eq("id", accountId);
  });
});
