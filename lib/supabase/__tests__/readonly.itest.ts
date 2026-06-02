import { describe, expect, it } from "vitest";
import { createReadonlyClient } from "@/lib/supabase/readonly";

// Requires local Supabase + SUPABASE_JWT_SECRET in .env.local (the local default
// secret is fine). Verifies the role can read but not write.
describe("createReadonlyClient (integration)", () => {
  it("can SELECT", async () => {
    const db = createReadonlyClient();
    const { error } = await db.from("categories").select("id").limit(1);
    expect(error).toBeNull();
  });

  it("cannot INSERT (no write grant)", async () => {
    const db = createReadonlyClient();
    const { error } = await db.from("categories").insert({ name: "RO_SHOULD_FAIL", kind: "expense" });
    expect(error).not.toBeNull(); // permission denied for table categories
  });
});
