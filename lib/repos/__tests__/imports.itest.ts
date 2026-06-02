import { afterEach, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteProfile, listProfiles, saveProfile } from "@/lib/repos/imports";
import type { ColumnMapping } from "@/lib/domain/types";

const db = createAdminClient();
const created: string[] = [];

const mapping: ColumnMapping = {
  dateColumn: "Date",
  dateFormat: "YYYY-MM-DD",
  descriptionColumns: ["Description"],
  amount: { mode: "signed", amountColumn: "Amount" },
  decimalSep: ".",
  defaultCurrency: "PLN",
};

afterEach(async () => {
  for (const id of created.splice(0)) {
    await db.from("import_profiles").delete().eq("id", id);
  }
});

describe("import profiles repo (integration)", () => {
  it("lists a saved profile then deletes it", async () => {
    const id = await saveProfile(db, {
      headerSignature: "itest-sig|date|amount|desc",
      columnMapping: mapping,
      delimiter: ",",
      encoding: "utf-8",
    });
    created.push(id);

    const list = await listProfiles(db);
    const row = list.find((p) => p.id === id);
    expect(row).toBeTruthy();
    expect(row!.headerSignature).toContain("itest-sig");

    await deleteProfile(db, id);
    const after = await listProfiles(db);
    expect(after.find((p) => p.id === id)).toBeUndefined();
    created.splice(created.indexOf(id), 1);
  });
});
