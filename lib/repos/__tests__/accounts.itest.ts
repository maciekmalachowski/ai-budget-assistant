import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createAccount,
  deleteAccount,
  listAccounts,
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

// --- Original coverage (Phase 3): plain list/create round-trip ---

let legacyId: string;

afterAll(async () => {
  if (legacyId) await db.from("accounts").delete().eq("id", legacyId);
});

describe.sequential("accounts repository (integration)", () => {
  it("creates an account and lists it back", async () => {
    legacyId = await createAccount(db, { name: "ITEST Revolut", currency: "EUR" });
    const accounts = await listAccounts(db);
    const mine = accounts.find((a) => a.id === legacyId);
    expect(mine?.name).toBe("ITEST Revolut");
    expect(mine?.currency).toBe("EUR");
  });
});

// --- Phase 6C: counts, rename, guarded delete ---

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
