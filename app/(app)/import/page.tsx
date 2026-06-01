import { createAdminClient } from "@/lib/supabase/admin";
import { listAccounts } from "@/lib/repos/accounts";
import { ImportWizard } from "@/components/import/import-wizard";

export const dynamic = "force-dynamic";

const DEFAULT_CURRENCY = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "PLN";

export default async function ImportPage() {
  const db = createAdminClient();
  const accounts = await listAccounts(db);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Import</h1>
      <ImportWizard accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} defaultCurrency={DEFAULT_CURRENCY} />
    </div>
  );
}
