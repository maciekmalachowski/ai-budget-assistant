import { describe, it, expect } from "vitest";
import type { Db } from "@/lib/supabase/admin";
import { createQueryTools } from "@/lib/queries/tools";

// A db that explodes if touched — proves validation happens before any query.
const explodingDb = new Proxy({}, { get() { throw new Error("db should not be touched"); } }) as Db;

describe("createQueryTools input validation", () => {
  it("rejects an invalid totals.kind before hitting the db", async () => {
    const tools = createQueryTools(explodingDb);
    await expect(tools.totals({ period: "2026-05", kind: "bogus" } as never)).rejects.toThrow();
  });

  it("rejects a non-numeric list_transactions.limit before hitting the db", async () => {
    const tools = createQueryTools(explodingDb);
    await expect(tools.list_transactions({ limit: "lots" } as never)).rejects.toThrow();
  });
});
