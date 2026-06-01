import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

const TEST_EMAIL = "phase5a.auth.test@example.com";
const TEST_PASSWORD = "test-password-123";

describe("supabase auth (local)", () => {
  const admin = createAdminClient();
  let userId: string | undefined;

  beforeAll(async () => {
    // Owner accounts are provisioned by an admin (service role), not via public
    // sign-up. email_confirm:true makes the account immediately usable.
    const { data, error } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    userId = data.user?.id;
  });

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("signs in an existing user with email + password", async () => {
    const client = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await client.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    expect(error).toBeNull();
    expect(data.session?.access_token).toBeTruthy();
    expect(data.user?.email).toBe(TEST_EMAIL);
  });

  it("rejects a wrong password", async () => {
    const client = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await client.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: "definitely-wrong",
    });
    expect(error).not.toBeNull();
    expect(data.session).toBeNull();
  });
});
