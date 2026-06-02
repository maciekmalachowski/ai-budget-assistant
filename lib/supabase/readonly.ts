import "server-only";
import { createHmac } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const ROLE = "readonly_qa";
const TOKEN_TTL_SECONDS = 300;

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

/**
 * Mint a short-lived HS256 JWT carrying `role: "readonly_qa"`, signed with the
 * project's JWT secret. PostgREST validates the signature and SET ROLEs into the
 * claimed role for the request. Exported with a `__` prefix for unit testing only.
 */
export function __mintReadonlyJwt(secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ role: ROLE, iat: nowSeconds, exp: nowSeconds + TOKEN_TTL_SECONDS }));
  const data = `${header}.${payload}`;
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

/**
 * A Supabase client whose database requests run as the SELECT-only `readonly_qa`
 * role (used by the Q&A read path). The anon key is sent as `apikey` so the request
 * passes the API gateway; the minted role JWT is the `Authorization` bearer so
 * PostgREST switches roles. Server-only — never import in client code.
 */
export function createReadonlyClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (!url || !anonKey || !jwtSecret) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, or SUPABASE_JWT_SECRET in the environment",
    );
  }
  const token = __mintReadonlyJwt(jwtSecret);
  return createClient<Database>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
