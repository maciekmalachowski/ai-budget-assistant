import { createAdminClient } from "@/lib/supabase/admin";
import { listTransactions } from "@/lib/repos/transactions";
import { listCategories } from "@/lib/repos/categories";
import { TransactionsFilters } from "@/components/transactions/transactions-filters";
import { TransactionsTable } from "@/components/transactions/transactions-table";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ merchant?: string; category?: string; needsReview?: string }>;
}) {
  const sp = await searchParams;
  const db = createAdminClient();
  const [rows, categories] = await Promise.all([
    listTransactions(db, {
      merchant: sp.merchant,
      category: sp.category,
      needsReview: sp.needsReview === "1",
      limit: 200,
    }),
    listCategories(db),
  ]);
  const categoryNames = categories.map((c) => c.name);
  const categoryColors = Object.fromEntries(
    categories.map((c) => [c.name, c.color]),
  ) as Record<string, string | null>;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Transactions</h1>
      <TransactionsFilters categories={categoryNames} />
      <TransactionsTable rows={rows} categories={categoryNames} categoryColors={categoryColors} />
    </div>
  );
}
