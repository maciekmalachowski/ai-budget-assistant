import { createAdminClient } from "@/lib/supabase/admin";
import { listTransactions, getDistinctMonths } from "@/lib/repos/transactions";
import { listCategories } from "@/lib/repos/categories";
import { parsePeriod } from "@/lib/queries/period";
import { TransactionsFilters } from "@/components/transactions/transactions-filters";
import { TransactionsTable } from "@/components/transactions/transactions-table";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ merchant?: string; category?: string; needsReview?: string; month?: string }>;
}) {
  const sp = await searchParams;
  const db = createAdminClient();

  // A valid "YYYY-MM" month narrows to its inclusive date bounds; anything else is ignored.
  let fromISO: string | undefined;
  let toISO: string | undefined;
  if (sp.month && /^\d{4}-\d{2}$/.test(sp.month)) {
    try {
      ({ fromISO, toISO } = parsePeriod(sp.month));
    } catch {
      // out-of-range month (e.g. 2026-13) → no date filter
    }
  }

  const [rows, categories, months] = await Promise.all([
    listTransactions(db, {
      merchant: sp.merchant,
      category: sp.category,
      needsReview: sp.needsReview === "1",
      fromISO,
      toISO,
      limit: 200,
    }),
    listCategories(db),
    getDistinctMonths(db),
  ]);
  const categoryNames = categories.map((c) => c.name);
  const categoryColors = Object.fromEntries(
    categories.map((c) => [c.name, c.color]),
  ) as Record<string, string | null>;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Transactions</h1>
      <TransactionsFilters categories={categoryNames} months={months} />
      <TransactionsTable rows={rows} categories={categoryNames} categoryColors={categoryColors} />
    </div>
  );
}
