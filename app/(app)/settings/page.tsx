import { createAdminClient } from "@/lib/supabase/admin";
import { listAccountsWithCounts } from "@/lib/repos/accounts";
import { listCategoriesWithCounts } from "@/lib/repos/categories";
import { listProfiles } from "@/lib/repos/imports";
import { getUsageStats } from "@/lib/settings/usage";
import { MODELS } from "@/lib/ai/models";
import { AccountsSection } from "@/components/settings/accounts-section";
import { CategoriesSection } from "@/components/settings/categories-section";
import { ImportProfilesSection } from "@/components/settings/import-profiles-section";
import { AiConfigSection } from "@/components/settings/ai-config-section";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const db = createAdminClient();
  const [accounts, categories, profiles, usage] = await Promise.all([
    listAccountsWithCounts(db),
    listCategoriesWithCounts(db),
    listProfiles(db),
    getUsageStats(db),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <AccountsSection accounts={accounts} />
      <CategoriesSection categories={categories} />
      <ImportProfilesSection profiles={profiles} />
      <AiConfigSection
        models={{ categorize: MODELS.categorize, qa: MODELS.qa, insights: MODELS.insights }}
        usage={usage}
      />
    </div>
  );
}
