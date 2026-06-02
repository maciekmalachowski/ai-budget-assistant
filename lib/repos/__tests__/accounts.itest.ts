import { afterEach, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createAccount,
  deleteAccount,
  listAccountsWithCounts,
  renameAccount,
} from "@/lib/repos/accounts";

const db = createAdminClient();
const created: string[] = [];

afterEach(async () => {
  for (const id of created.splice(0)) {
    await db.from("transactions").delete().eq("account_id", id);
    await db.from("accounts").delete().eq("id", id);
  }
});

describe("accounts repo (integration)", () => {
  it("creates, lists with a zero count, renames", async () => {
    const id = await createAccount(db, { name: "Test Checking", currency: "PLN" });
    created.push(id);

    const before = await listAccountsWithCounts(db);
    const row = before.find((a) => a.id === id);
    expect(row).toBeTruthy();
    expect(row!.transactionCount).toBe(0);

    await renameAccount(db, id, "Renamed");
    const after = await listAccountsWithCounts(db);
    expect(after.find((a) => a.id === id)!.name).toBe("Renamed");
  });

  it("deletes an empty account but refuses one with transactions", async () => {
    const id = await createAccount(db, { name: "HasTxns", currency: "PLN" });
    created.push(id);
    await db.from("transactions").insert({
      account_id: id,
      booked_at: "2026-06-01",
      amount_minor: -1000,
      currency: "PLN",
      raw_description: "x",
      dedup_hash: "acc-itest-hash-1",
    });

    await expect(deleteAccount(db, id)).rejects.toThrow(/transaction/i);

    await db.from("transactions").delete().eq("account_id", id);
    await expect(deleteAccount(db, id)).resolves.toBeUndefined();
    created.splice(created.indexOf(id), 1); // already deleted
  });
});
