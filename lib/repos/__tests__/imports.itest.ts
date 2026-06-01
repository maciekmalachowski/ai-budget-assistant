import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createImportBatch,
  finalizeImportBatch,
  getProfileBySignature,
  saveProfile,
} from "@/lib/repos/imports";
import type { ColumnMapping } from "@/lib/domain/types";

const db = createAdminClient();
const SIGNATURE = "ITEST_HEADER_SIGNATURE";
let acctId: string;

const mapping: ColumnMapping = {
  dateColumn: "Date",
  dateFormat: "YYYY-MM-DD",
  descriptionColumns: ["Description"],
  amount: { mode: "signed", amountColumn: "Amount" },
  decimalSep: ".",
  defaultCurrency: "PLN",
};

beforeAll(async () => {
  const { data, error } = await db.from("accounts").insert({ name: "ITEST import acct", currency: "PLN" }).select("id").single();
  if (error) throw new Error(error.message);
  acctId = data.id;
});

afterAll(async () => {
  await db.from("accounts").delete().eq("id", acctId); // cascades batches
  await db.from("import_profiles").delete().eq("header_signature", SIGNATURE);
});

describe.sequential("imports repository (integration)", () => {
  it("creates a batch then finalizes its counts + status", async () => {
    const batchId = await createImportBatch(db, { accountId: acctId, fileName: "may.csv", rowCount: 3 });
    await finalizeImportBatch(db, batchId, { rowCount: 3, importedCount: 2, duplicateCount: 1, status: "imported" });
    const { data } = await db.from("import_batches").select("imported_count, duplicate_count, status").eq("id", batchId).single();
    expect(data).toEqual({ imported_count: 2, duplicate_count: 1, status: "imported" });
  });

  it("saves a profile and restores it by signature (round-trips the column mapping)", async () => {
    await saveProfile(db, { headerSignature: SIGNATURE, columnMapping: mapping, dateFormat: "YYYY-MM-DD", delimiter: ";", decimalSep: ".", encoding: "utf-8" });
    const restored = await getProfileBySignature(db, SIGNATURE);
    expect(restored?.columnMapping).toEqual(mapping);
    expect(restored?.delimiter).toBe(";");
  });

  it("upserts the profile in place on a second save (signature is unique)", async () => {
    const id1 = (await getProfileBySignature(db, SIGNATURE))!.id;
    await saveProfile(db, { headerSignature: SIGNATURE, columnMapping: mapping, delimiter: "," });
    const after = await getProfileBySignature(db, SIGNATURE);
    expect(after?.id).toBe(id1);
    expect(after?.delimiter).toBe(",");
  });

  it("returns null for an unknown signature", async () => {
    expect(await getProfileBySignature(db, "NOPE_NOT_A_SIGNATURE")).toBeNull();
  });
});
