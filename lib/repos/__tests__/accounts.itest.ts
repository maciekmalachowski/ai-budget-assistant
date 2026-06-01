import { describe, it, expect, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { listAccounts, createAccount } from "@/lib/repos/accounts";

const db = createAdminClient();
let createdId: string;

afterAll(async () => {
  if (createdId) await db.from("accounts").delete().eq("id", createdId);
});

describe.sequential("accounts repository (integration)", () => {
  it("creates an account and lists it back", async () => {
    createdId = await createAccount(db, { name: "ITEST Revolut", currency: "EUR" });
    const accounts = await listAccounts(db);
    const mine = accounts.find((a) => a.id === createdId);
    expect(mine?.name).toBe("ITEST Revolut");
    expect(mine?.currency).toBe("EUR");
  });
});
