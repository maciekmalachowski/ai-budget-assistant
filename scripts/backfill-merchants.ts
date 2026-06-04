import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { ColumnMapping } from "@/lib/domain/types";
import { backfillMerchants, enrichFromCsv } from "@/lib/transactions/backfillMerchants";
import { seedMerchantRules } from "@/lib/repos/merchantMap";
import { parseCsvMatrixBuffer, matrixToRawRows } from "@/lib/csv/parse";

/** Fixed Santander Bank Polska layout (9 columns, no header, preamble on row 1). */
const SANTANDER_MAPPING: ColumnMapping = {
  dateColumn: "Column 1",
  dateFormat: "DD-MM-YYYY",
  descriptionColumns: ["Column 3"],
  counterpartyColumn: "Column 4",
  counterpartyAccountColumn: "Column 5",
  amount: { mode: "signed", amountColumn: "Column 6" },
  decimalSep: ",",
  defaultCurrency: "PLN",
};

async function main() {
  config({ path: ".env.local" });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const seeded = await seedMerchantRules(db);
  console.log(`Seeded ${seeded} merchant rule(s).`);

  // Optional CSV-enrich:  tsx scripts/backfill-merchants.ts <csvFile> <accountId>
  const [csvFile, accountId] = process.argv.slice(2);
  if (csvFile && accountId) {
    const buf = readFileSync(csvFile);
    const { columns, rows } = parseCsvMatrixBuffer(buf);
    const dataRows = matrixToRawRows(rows.slice(1), columns); // drop the preamble row
    const enriched = await enrichFromCsv(db, { accountId, rows: dataRows, mapping: SANTANDER_MAPPING });
    console.log(`Enrich from ${csvFile}: matched=${enriched.matched}, updated=${enriched.updated}, unmatched=${enriched.unmatched}`);
  }

  const result = await backfillMerchants(db);
  console.log(`Backfill: scanned=${result.scanned}, merchantsUpdated=${result.merchantsUpdated}, recategorized=${result.recategorized}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
