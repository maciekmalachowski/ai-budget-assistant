import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { backfillMerchants } from "@/lib/transactions/backfillMerchants";

async function main() {
  config({ path: ".env.local" });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }

  const db = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const result = await backfillMerchants(db);
  console.log(
    `Backfill complete: scanned=${result.scanned}, merchantsUpdated=${result.merchantsUpdated}, recategorized=${result.recategorized}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
